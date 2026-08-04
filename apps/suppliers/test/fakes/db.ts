import { drizzle } from "drizzle-orm/pg-proxy";
import { schema } from "@quagga/db";
import type { Database } from "@quagga/db";

// A DRIZZLE HANDLE WITH NO DATABASE BEHIND IT — the shared fake every lib/
// test drives its queries through.
//
// WHY NOT A HAND-ROLLED CHAIN OF STUBS. The obvious fake is an object with
// `.select().from().where()` returning a queued result. It runs, but it proves
// almost nothing: the WHERE clause is an opaque object nobody asserts on, so
// dropping `eq(notifications.userId, session.dbUserId)` — the entire authz of
// the notification actions — leaves every test green. A fake that answers by
// call ORDER is worse still: reorder two queries in the source and each test
// keeps passing for the wrong reason.
//
// So this drives the REAL drizzle query builder over `drizzle-orm/pg-proxy`,
// whose driver seam is `(sql, params, method)`. Everything above the seam is
// production code: real column names, real predicate compilation, real
// `onConflictDoNothing`, real `for("update")`, real `returning`. Tests assert
// on the SQL TEXT and the BOUND PARAMS, which is where the decisions actually
// show up.
//
// WHAT THIS STILL CANNOT PROVE, and no test in this suite should imply it can:
// Postgres' own semantics. `ON CONFLICT DO NOTHING` really de-duplicating,
// `FOR UPDATE` really serialising two writers, `ILIKE` really matching, the
// `suppliers.code` unique constraint really arbitrating the code-assignment
// retry — all of those are asserted here only as INTENT (the statement was
// issued, with these predicates). The behaviour is proven by the persona suite
// under `pnpm e2e:local`, against a real database. This repo has already been
// burned by that exact gap once: a migration verified live — inserts, both
// uniqueness rules, the cascade — that still broke every questionnaire write,
// because the verification never ran the `ON CONFLICT` upsert the app uses.

/** One statement the code under test actually issued. */
export interface RecordedQuery {
  /** Compiled SQL, e.g. `select "id" from "suppliers" where ...`. */
  sql: string;
  /** Bound parameters, in order. */
  params: unknown[];
  /** drizzle's driver method — `all` for row-returning, `execute` otherwise. */
  method: string;
  /** The table the statement targets (`suppliers`, `notifications`, …). */
  table: string;
}

/**
 * A row a test hands back. An OBJECT keyed by the property names the source's
 * `.select({ … })` uses is the readable form; an ARRAY (positional, in select
 * order) is the escape hatch for a projection with a raw SQL expression in it,
 * which carries no column name to key on.
 */
export type FakeRow = Record<string, unknown> | readonly unknown[];

/** A queued answer: the rows for one statement, or a failure to throw. */
export type FakeBatch = readonly FakeRow[] | Error;

/**
 * Timestamp columns are `mode: "date"` without a timezone, so drizzle decodes
 * them as `new Date(value + "+0000")`. Give the driver the Postgres text form
 * or every date arrives as `Invalid Date` — silently, since an invalid Date is
 * still a Date.
 */
export function pgTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function tableOf(sql: string): string {
  const m =
    /^insert into "([a-z_]+)"/.exec(sql) ??
    /^update "([a-z_]+)"/.exec(sql) ??
    /^delete from "([a-z_]+)"/.exec(sql) ??
    / from "([a-z_]+)"/.exec(sql);
  return m?.[1] ?? "";
}

/** Split a projection list on commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The property key each projected column lands on, or null for a raw SQL
 * expression (`count(*)::int`, `"user_id" IS NOT NULL`) which has no name.
 */
function projectionKeys(sql: string): (string | null)[] {
  let list: string;
  if (sql.startsWith("select ")) {
    const from = sql.indexOf(' from "');
    list =
      from === -1
        ? sql.slice("select ".length)
        : sql.slice("select ".length, from);
  } else {
    const at = sql.lastIndexOf(" returning ");
    if (at === -1) return [];
    list = sql.slice(at + " returning ".length);
  }
  return splitTopLevel(list).map((item) => {
    const t = item.trim();
    const qualified = /^"[a-z_]+"\."([a-z_0-9]+)"$/.exec(t);
    if (qualified) return snakeToCamel(qualified[1]!);
    const bare = /^"([a-z_0-9]+)"$/.exec(t);
    if (bare) return snakeToCamel(bare[1]!);
    return null;
  });
}

/**
 * A drizzle handle backed by queued answers, recording every statement.
 *
 * Answers are queued PER TABLE and consumed in order, so a test that reads
 * `suppliers` twice (the linked lookup, then the email-overlap candidates)
 * says so explicitly. An exhausted queue answers with no rows rather than
 * repeating the last batch — a silently repeated answer is how a fake starts
 * agreeing with a source that changed.
 */
export class FakeDb {
  readonly queries: RecordedQuery[] = [];
  private readonly queues = new Map<string, FakeBatch[]>();
  /** When set, EVERY statement throws it (an unreachable database). */
  failEverything: Error | null = null;

  readonly handle: Database;

  constructor() {
    this.handle = drizzle(
      async (sql, params, method) => {
        const table = tableOf(sql);
        this.queries.push({ sql, params, method, table });
        if (this.failEverything) throw this.failEverything;
        // Only ROW-RETURNING statements consume a queued answer. A plain
        // insert/update/delete returns nothing, so letting it eat an answer
        // would silently shift every later read of the same table onto the
        // wrong batch — which is exactly the kind of accidental coupling a fake
        // must not introduce. (`… returning` compiles to `all`, and does.)
        if (method !== "all") return { rows: [] };
        const batch = this.queues.get(table)?.shift();
        if (batch instanceof Error) throw batch;
        const keys = projectionKeys(sql);
        return {
          rows: (batch ?? []).map((row) => {
            if (Array.isArray(row)) return [...row] as unknown[];
            const obj = row as Record<string, unknown>;
            return keys.map((key, i) => {
              if (key === null) {
                throw new Error(
                  `FakeDb: column ${i} of \`${sql}\` is a raw SQL expression with no ` +
                    `name — queue this row as an array, not an object.`,
                );
              }
              return obj[key] ?? null;
            });
          }),
        };
      },
      { schema },
    ) as unknown as Database;
  }

  /**
   * Queue one answer per statement against `table`, consumed in order.
   *
   * REPLACES any queue already set for that table, so a `beforeEach` can
   * establish the ordinary arrangement and a single test can override one
   * table without the two silently concatenating.
   */
  rows(table: string, ...batches: FakeBatch[]): this {
    this.queues.set(table, [...batches]);
    return this;
  }

  /** Every statement issued against `table`, in order. */
  against(table: string): RecordedQuery[] {
    return this.queries.filter((q) => q.table === table);
  }

  /** The SQL text of every statement, in issue order — the call SEQUENCE. */
  get sequence(): string[] {
    return this.queries.map((q) => q.sql);
  }

  /** Statements whose SQL contains `fragment` (a cheap "did we do X?"). */
  matching(fragment: string): RecordedQuery[] {
    return this.queries.filter((q) => q.sql.includes(fragment));
  }
}

// --- The handle the `@/lib/db` mocks reach for ----------------------------
//
// `vi.mock` factories are hoisted above the test file's own bindings, so they
// cannot close over a `const` the test declares. They resolve THIS module
// instead and call `fakeDb()` lazily, at query time, which is after
// `installFakeDb()` has run in `beforeEach`.

let installed: FakeDb | null = null;

/** Fresh handle for one test. Call in `beforeEach`. */
export function installFakeDb(): FakeDb {
  installed = new FakeDb();
  return installed;
}

/** The handle installed for the current test. */
export function fakeDb(): FakeDb {
  if (!installed) {
    throw new Error(
      "no fake db installed — call installFakeDb() in beforeEach",
    );
  }
  return installed;
}

export { schema };

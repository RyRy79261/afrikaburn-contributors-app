import { getTableName, type Table } from "drizzle-orm";

/**
 * A TABLE-KEYED FAKE OF THE DRIZZLE BUILDER, and the reason most of the console
 * is executable in a unit test at all.
 *
 * Every read in `lib/` is `db.select({…}).from(t)…` and every write is
 * `db.insert(t).values(…)`. None of them use the relational API, a CTE, a union
 * or a subquery, so the chain surface is small and closed: each method returns
 * the same thenable proxy, and awaiting it resolves the rows seeded for the
 * table named by `.from()` / `.insert()` / `.update()` / `.delete()`.
 *
 * ── WHAT THIS PROVES, AND WHAT IT CANNOT ────────────────────────────────────
 *
 * It proves PROJECTION, AUTHORISATION and MAPPING: which columns a caller's
 * query asked for, whether a refusal happened before any query was issued, which
 * table was written and with what values, and how rows become the objects a page
 * renders. It proves NOTHING about SQL semantics — not a WHERE clause, not a
 * join, not an ON CONFLICT, not an ordering. Those keep their real-database
 * proof in `pnpm e2e:local`, and a green test here must never be reported as
 * evidence that a query is correct.
 *
 * ── WHY IT APPLIES THE PROJECTION ───────────────────────────────────────────
 *
 * The seeded row is projected down to the keys the module actually SELECTED
 * before it is handed back. That is what makes a personal-information assertion
 * real rather than decorative: the console decides personal information AT THE
 * SELECT (`...(personal ? { email: … } : {})`), so a fake that returned the whole
 * seeded row regardless would hand the email to a refused caller and the test
 * would fail for the wrong reason — or, worse, pass for one. With the projection
 * applied, dropping the conditional from the module puts the column back in the
 * refused caller's row and the test goes red.
 *
 * Seed rows are keyed BY TABLE, never by call order. A call-order queue breaks
 * confusingly the moment someone reorders two independent queries; the table
 * name survives a refactor. Where one action reads the same table twice
 * (`decideRegistration` selects the registration, then updates and `.returning()`s
 * it), seed an array of arrays for that table and each successive read shifts one
 * result off the queue.
 */

/** One recorded step of a builder chain, for assertions about what happened. */
export interface DbCall {
  /** `select` | `insert` | `update` | `delete` | `$count` | `execute`. */
  op: string;
  /** The drizzle table name, e.g. `audit_events`. Null before `.from()` runs. */
  table: string | null;
  /** The projection keys a `select`/`returning` asked for, when there was one. */
  columns?: string[];
  /** The values handed to `.values()` / `.set()`. */
  values?: unknown;
  /**
   * The condition handed to `.where()`, as drizzle built it — `undefined` when
   * the module passed no filter at all.
   *
   * Recorded because "a `where` was called" is nearly vacuous: `.where(undefined)`
   * is still a call. What distinguishes "the medical rows were filtered out for
   * this caller" from "they were not" is whether a condition was BUILT, and for
   * a literal-bearing condition `whereMentions()` can see the literal.
   */
  where?: unknown;
  /** Every method called on the chain, in order — `["from","where","limit"]`. */
  methods: string[];
}

type Row = Record<string, unknown>;
/** Rows for a table: one result set, or a queue of them for repeated reads. */
export type SeedValue = Row[] | Row[][];

export interface FakeDbOptions {
  /** `{ users: [ … ] }` — keys are drizzle TABLE NAMES (`org_roles`, not orgRoles). */
  rows?: Record<string, SeedValue>;
  /** What `db.$count(table)` answers for each table. Defaults to 0. */
  counts?: Record<string, number>;
}

function isQueue(value: SeedValue): value is Row[][] {
  return Array.isArray(value[0]);
}

export class FakeDb {
  /** Every chain that ran, oldest first. The audit-row assertions read this. */
  readonly calls: DbCall[] = [];
  private readonly rows: Map<string, SeedValue>;
  private readonly counts: Map<string, number>;

  constructor(options: FakeDbOptions = {}) {
    this.rows = new Map(Object.entries(options.rows ?? {}));
    this.counts = new Map(Object.entries(options.counts ?? {}));
  }

  /** Tables whose next access throws — for the "the database is down" branches. */
  private readonly failures = new Map<string, Error>();

  /** Seed (or re-seed) one table mid-test. */
  seed(table: string, rows: SeedValue): void {
    this.rows.set(table, rows);
  }

  /**
   * Make every access to `table` throw. Modules that must degrade rather than
   * crash (`resolveOrgSession` → `not_ready`, `probeDatabase` → a reported
   * failure) are only honestly tested against a database that actually fails.
   */
  fail(table: string, message = "connection terminated"): void {
    this.failures.set(table, new Error(message));
  }

  /** Every recorded call for one op, e.g. `db.recorded("insert")`. */
  recorded(op: string, table?: string): DbCall[] {
    return this.calls.filter(
      (c) => c.op === op && (table === undefined || c.table === table),
    );
  }

  /** The values written by the single `insert` into `table` (fails loudly if none). */
  inserted(table: string): unknown {
    const [call] = this.recorded("insert", table);
    if (!call) throw new Error(`no insert into ${table} was recorded`);
    return call.values;
  }

  private take(call: DbCall): Row[] {
    const failure = this.failures.get(call.table ?? "");
    if (failure) throw failure;
    const seeded = this.rows.get(call.table ?? "");
    if (!seeded) return [];
    // Only a READ consumes a queue entry: a `select`, or a write that asked for
    // its rows back with `.returning()`. An `insert`/`update` without one is
    // awaited too, and letting it eat a queued result made the seed order
    // depend on how many writes happened to sit between two reads.
    const reads = call.op === "select" || call.methods.includes("returning");
    let result: Row[];
    if (isQueue(seeded)) {
      result = reads ? (seeded.shift() ?? []) : [];
    } else {
      result = reads ? seeded : [];
    }
    const columns = call.columns;
    if (!columns) return result.map((r) => ({ ...r }));
    // Project exactly what was selected. A column the module did not ask for is
    // ABSENT, which is what makes `"email" in row` a real test of the select.
    return result.map((row) => {
      const projected: Row = {};
      for (const key of columns) projected[key] = key in row ? row[key] : null;
      return projected;
    });
  }

  private chain(call: DbCall): unknown {
    // A callable target, because drizzle's builders are objects that some code
    // paths `await` and others keep chaining on.
    const target = function () {} as unknown as Row;
    return new Proxy(target, {
      // Arrow handlers on purpose: they close over `this` lexically, so the
      // proxy reaches the FakeDb without aliasing it to a local.
      get: (_t, prop) => {
        if (prop === "then") {
          return (
            resolve: (rows: Row[]) => unknown,
            reject: (err: unknown) => unknown,
          ) => {
            try {
              resolve(this.take(call));
            } catch (err) {
              reject(err);
            }
          };
        }
        if (typeof prop === "symbol") return undefined;
        const method = String(prop);
        return (...args: unknown[]) => {
          call.methods.push(method);
          if (method === "from" || method === "into") {
            call.table = getTableName(args[0] as Table);
          } else if (method === "values" || method === "set") {
            call.values = args[0];
          } else if (method === "where") {
            call.where = args[0];
          } else if (method === "returning") {
            call.columns = args[0] ? Object.keys(args[0] as Row) : call.columns;
          }
          return this.chain(call);
        };
      },
    });
  }

  private start(op: string, table: string | null, columns?: string[]): unknown {
    const call: DbCall = { op, table, columns, methods: [] };
    this.calls.push(call);
    return this.chain(call);
  }

  select(projection?: Record<string, unknown>) {
    return this.start(
      "select",
      null,
      projection ? Object.keys(projection) : undefined,
    );
  }

  insert(table: Table) {
    return this.start("insert", getTableName(table));
  }

  update(table: Table) {
    return this.start("update", getTableName(table));
  }

  delete(table: Table) {
    return this.start("delete", getTableName(table));
  }

  execute(query: unknown) {
    this.calls.push({ op: "execute", table: null, values: query, methods: [] });
    return Promise.resolve([]);
  }

  async $count(table: Table): Promise<number> {
    const name = getTableName(table);
    this.calls.push({ op: "$count", table: name, methods: [] });
    return this.counts.get(name) ?? 0;
  }

  /**
   * The transaction handle is THIS SAME FAKE, so a test asserts on one call log
   * whether the write happened standalone or inside `withTransaction`. Rollback
   * is not modelled: what these tests check is that the writes were issued
   * together, which the recorded calls show.
   */
  async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/**
 * Build a fake and hand back the handle `@quagga/db`'s `createHttpDb` should
 * return. Typed as the drizzle `Database` at the seam so the modules under test
 * are the real ones, unchanged.
 */
export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  return new FakeDb(options);
}

/**
 * Whether a recorded `where` condition carries `literal` as a bound parameter.
 *
 * Drizzle conditions are SQL trees whose leaves hold the values the module put
 * in them, so a filter written as `ne(auditEvents.action, "bio.medical.view")`
 * is distinguishable from no filter at all AND from a filter on something else.
 * That is as far as this goes: it proves which value the query was BUILT with,
 * never what Postgres does with it — the SQL semantics stay `pnpm e2e:local`'s.
 */
export function whereMentions(condition: unknown, literal: string): boolean {
  const seen = new Set<unknown>();
  const walk = (node: unknown): boolean => {
    if (node === literal) return true;
    if (node === null || typeof node !== "object") return false;
    if (seen.has(node)) return false;
    seen.add(node);
    return Object.values(node as Record<string, unknown>).some(walk);
  };
  return walk(condition);
}

// A fake for the Drizzle handle that `lib/db.ts` hands out, so the store
// helpers in `lib/` can be executed without a Postgres.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. A test built on this asserts a
// DECISION — who is refused, what is redacted, which write is issued, what
// shape comes back — not a query. It cannot catch a wrong WHERE clause, a
// missing edition filter or a broken join; that is what the source-assertion
// tests (deletion-guards, decision-reason-invariant) and the Playwright
// persona suite are for. Do not read a green suite here as "the SQL is right".
//
// HOW IT WORKS. `db()` returns a Proxy whose every property is a function that
// returns the same Proxy, so any builder chain drizzle offers is accepted
// without this file having to know about it. `then` is the exception: awaiting
// a chain shifts the next value off the queue, so a test says what the database
// answers, in order, and never has to describe the query. A queued Error is
// REJECTED rather than returned — that is how the unique-violation mappings
// (`23505` → a graceful message) get exercised at all.
//
// WHY A SHARED SINGLETON. `vi.mock`'s factory is hoisted above the imports, so
// a test file cannot hand it a locally-constructed harness. Every file mocks
// `../db` with the same lazily-imported factory and talks to the one instance:
//
//   vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
//   beforeEach(() => dbMock.reset());

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  /** The call that opened the chain — select / insert / update / delete. */
  kind: string;
  /** Every call in the chain, in order. */
  calls: RecordedCall[];
  /** True when the chain was issued against a `withTransaction` handle. */
  tx: boolean;
  /** First argument of the first `method` call in this chain. */
  arg(method: string): unknown;
  /** Did the chain call `method` at all? */
  called(method: string): boolean;
}

class DbMock {
  /** Values the next awaited chains resolve to, in order. */
  private results: unknown[] = [];
  /** Every chain built since the last `reset()`, in the order they started. */
  queries: RecordedQuery[] = [];
  /** Set true by `runTransaction` while the callback is running. */
  private inTransaction = false;
  /** Incremented every time `withTransaction` is entered. */
  transactions = 0;

  /** Queue what the database answers, one value per awaited chain. An `Error`
   * is thrown from the await instead of returned. */
  queue(...results: unknown[]): this {
    this.results.push(...results);
    return this;
  }

  /** Queued values not yet consumed — assert 0 when a test cares that every
   * query it set up actually ran. */
  get pending(): number {
    return this.results.length;
  }

  reset(): void {
    this.results = [];
    this.queries = [];
    this.inTransaction = false;
    this.transactions = 0;
  }

  /** Chains whose opening call was `kind` (e.g. every `insert`). */
  queriesOfKind(kind: string): RecordedQuery[] {
    return this.queries.filter((q) => q.kind === kind);
  }

  /** Chains that named this drizzle table anywhere — `insert(t)`, `update(t)`,
   * `delete(t)`, `select().from(t)`. Identity comparison against the REAL
   * schema object, so a test can say "no row was written to `users`" and mean
   * it rather than counting queries. */
  queriesTouching(table: unknown): RecordedQuery[] {
    return this.queries.filter((q) =>
      q.calls.some((c) => c.args.some((a) => a === table)),
    );
  }

  /** As above, narrowed to writes. */
  writesTo(table: unknown): RecordedQuery[] {
    return this.queriesTouching(table).filter((q) =>
      ["insert", "update", "delete"].includes(q.kind),
    );
  }

  /** The single chain of `kind`, or a clear failure if there is not exactly
   * one — an assertion that silently reads query 0 of 3 is a trap. */
  onlyQuery(kind: string): RecordedQuery {
    const found = this.queriesOfKind(kind);
    if (found.length !== 1) {
      throw new Error(
        `expected exactly one ${kind} query, saw ${found.length} (${this.queries
          .map((q) => q.kind)
          .join(", ")})`,
      );
    }
    return found[0]!;
  }

  private nextResult(): unknown {
    // An unqueued chain answers "no rows". Reads far outnumber the rows a test
    // cares about, and `await db().insert(...).values(...)` consumes one too.
    return this.results.length > 0 ? this.results.shift() : [];
  }

  private startQuery(method: string, args: unknown[]): unknown {
    const calls: RecordedCall[] = [{ method, args }];
    const query: RecordedQuery = {
      kind: method,
      calls,
      tx: this.inTransaction,
      arg: (m) => calls.find((c) => c.method === m)?.args[0],
      called: (m) => calls.some((c) => c.method === m),
    };
    this.queries.push(query);
    return this.chain(calls);
  }

  private chain(calls: RecordedCall[]): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_target, prop) => {
          // Symbols (inspect, iterator, toPrimitive) must stay absent, or
          // logging or expect()ing a chain behaves very strangely.
          if (typeof prop === "symbol") return undefined;
          if (prop === "then") {
            return (
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => {
              const value = this.nextResult();
              const settled =
                value instanceof Error
                  ? Promise.reject(value)
                  : Promise.resolve(value);
              return settled.then(onFulfilled, onRejected);
            };
          }
          if (prop === "catch" || prop === "finally") return undefined;
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  /** What `db()` returns. */
  get handle(): unknown {
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop === "symbol") return undefined;
          // `tx.transaction(fn)` opens a SAVEPOINT in drizzle. Run the
          // callback rather than recording it, so the writes inside a
          // savepoint are real writes here and a queued Error rolls that
          // attempt back exactly as the retry loops expect.
          if (prop === "transaction") {
            return (fn: (tx: never) => Promise<unknown>) =>
              this.runTransaction(fn);
          }
          return (...args: unknown[]) => this.startQuery(prop, args);
        },
      },
    );
  }

  /** What `withTransaction` does: run the callback against the same handle,
   * with every chain it issues marked `tx: true`. */
  async runTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
    const outer = this.inTransaction;
    this.transactions += 1;
    this.inTransaction = true;
    try {
      return await fn(this.handle as never);
    } finally {
      // Restore rather than clear: a savepoint nests inside a transaction.
      this.inTransaction = outer;
    }
  }
}

/** The one harness every mocked `lib/db` shares. Reset it in `beforeEach`. */
export const dbMock = new DbMock();

/**
 * The replacement module for `lib/db`. `schema` stays REAL — the store helpers
 * reference `schema.users.id` and friends to build their queries, and swapping
 * those for stand-ins would mean the code under test is no longer the code that
 * ships. `isDatabaseConfigured` also stays real, so a test controls it the way
 * production does: by setting or unsetting `DATABASE_URL`.
 */
export async function dbModuleMock(): Promise<Record<string, unknown>> {
  const { schema } = await import("@quagga/db");
  const { isDatabaseConfigured } = await import("@/lib/config");
  return {
    db: () => dbMock.handle,
    schema,
    isDatabaseConfigured,
    requireDb: () => isDatabaseConfigured(),
    withTransaction: (fn: (tx: never) => Promise<unknown>) =>
      dbMock.runTransaction(fn),
  };
}

/**
 * Every string bound anywhere in a chain's arguments — the parameters, in
 * effect. Drizzle's SQL objects are CYCLIC (a column points at its table, which
 * points back at the column), so serialising one throws; this walks with a
 * seen-set instead. Use it to assert that a query carried a hash and not the
 * token it came from.
 */
export function boundStrings(query: RecordedQuery): string[] {
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 12) return;
    if (typeof value === "string") {
      found.push(value);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  for (const call of query.calls) walk(call.args, 0);
  return found;
}

/** A Postgres unique-violation, the shape drizzle/pg surfaces it in. Queue one
 * to drive the `23505` → graceful-message branches. */
export function uniqueViolation(constraint = "some_unique_idx"): Error {
  const err = new Error(
    `duplicate key value violates unique constraint "${constraint}"`,
  ) as Error & { code: string; constraint: string };
  err.code = "23505";
  err.constraint = constraint;
  return err;
}

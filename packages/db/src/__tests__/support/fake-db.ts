// A stand-in drizzle query builder, for the decision logic that sits AROUND a
// query rather than inside it.
//
// WHY IT EXISTS: `deletion.ts` and the two `ensure*` helpers in `seed.ts` are
// mostly branches — resolve an id before using it, refuse an elapsed grace,
// write the domains only when the department insert returned a row. Those
// branches are what a regression breaks, and driving them needs a `db` that
// ANSWERS, not a database.
//
// WHAT IT IS NOT: proof that any statement here is valid SQL. It cannot be. A
// mismatched `ON CONFLICT` target, a column that no longer exists, a uuid
// compared to text — none of that shows up against a fake. `tsc --noEmit`
// catches the type-level half and the e2e suite against a real Postgres catches
// the rest; the tests that use this say so where it matters.
//
// It records what was issued rather than rendering SQL, so the assertions read
// as "the first select filtered on users.auth_user_id" instead of pinning
// drizzle's string formatting.

import { Column, Param, SQL, getTableName, is } from "drizzle-orm";

export interface WhereFilter {
  /** The snake_case column the predicate compares. */
  column: string;
  /** The bound parameter it compares against. */
  value: unknown;
}

/**
 * Pull `column = value` pairs out of a drizzle predicate.
 *
 * The column is the load-bearing part: audit B1 was a predicate on the WRONG
 * COLUMN (Better Auth's text id against our uuid `users.id`), which no
 * assertion about a rendered string would have named clearly.
 */
export function whereFilters(node: unknown): WhereFilter[] {
  const found: WhereFilter[] = [];
  let pending: string | null = null;
  const walk = (chunk: unknown): void => {
    if (is(chunk, SQL)) {
      for (const inner of chunk.queryChunks) walk(inner);
      return;
    }
    if (is(chunk, Column)) {
      pending = chunk.name;
      return;
    }
    if (is(chunk, Param)) {
      found.push({ column: pending ?? "<unbound>", value: chunk.value });
      pending = null;
    }
  };
  walk(node);
  return found;
}

/** One statement the code under test issued, as the fake saw it. */
export interface RecordedOp {
  kind: "select" | "insert" | "update" | "delete";
  /** snake_case table name, from drizzle's own `getTableName`. */
  table: string | null;
  /** True when issued on a `transaction()` callback's `tx`. */
  inTransaction: boolean;
  /** Selected column names, for a select. */
  projection: string[];
  /** Rows handed to `.values()`, for an insert. */
  values: Record<string, unknown>[];
  /** The patch handed to `.set()`, for an update. */
  set: Record<string, unknown> | null;
  where: WhereFilter[];
  ordered: boolean;
  limit: number | null;
  returning: boolean;
  /** Column names named by `onConflict*({ target })`. */
  conflictTarget: string[];
  conflictAction: "nothing" | "update" | null;
}

/** Answers a statement. Return the rows the driver would have returned. */
export type OpHandler = (op: RecordedOp) => unknown[];

export interface FakeDbHandle {
  /**
   * Cast this where the source expects a drizzle `Database` — it implements
   * only the surface the code under test actually calls.
   */
  db: unknown;
  /** Every statement issued, in order. */
  ops: RecordedOp[];
  /** How many times `transaction()` was opened. */
  readonly transactions: number;
  /** Statements against one table, optionally narrowed to one kind. */
  opsOn(table: string, kind?: RecordedOp["kind"]): RecordedOp[];
}

function columnNames(arg: unknown): string[] {
  if (is(arg, Column)) return [arg.name];
  if (Array.isArray(arg)) return arg.flatMap(columnNames);
  if (arg && typeof arg === "object") {
    return Object.values(arg as Record<string, unknown>).flatMap(columnNames);
  }
  return [];
}

/**
 * @param handler answers each statement; defaults to "no rows".
 */
export function createFakeDb(handler: OpHandler = () => []): FakeDbHandle {
  const ops: RecordedOp[] = [];
  const state = { depth: 0, opened: 0 };

  const start = (kind: RecordedOp["kind"], projection: string[] = []) => {
    const op: RecordedOp = {
      kind,
      table: null,
      inTransaction: state.depth > 0,
      projection,
      values: [],
      set: null,
      where: [],
      ordered: false,
      limit: null,
      returning: false,
      conflictTarget: [],
      conflictAction: null,
    };
    ops.push(op);

    // Every builder method returns `chain`, and `chain` is thenable — so the
    // source's `await db.select(...).from(...).where(...)` resolves through the
    // handler with the whole op assembled.
    const chain = {
      from(table: unknown) {
        op.table = getTableName(table as Parameters<typeof getTableName>[0]);
        return chain;
      },
      where(predicate: unknown) {
        op.where = whereFilters(predicate);
        return chain;
      },
      orderBy(..._order: unknown[]) {
        op.ordered = true;
        return chain;
      },
      limit(n: number) {
        op.limit = n;
        return chain;
      },
      set(patch: Record<string, unknown>) {
        op.set = patch;
        return chain;
      },
      values(rows: Record<string, unknown> | Record<string, unknown>[]) {
        op.values = Array.isArray(rows) ? rows : [rows];
        return chain;
      },
      returning(_cols?: unknown) {
        op.returning = true;
        return chain;
      },
      onConflictDoNothing(config?: { target?: unknown }) {
        op.conflictAction = "nothing";
        op.conflictTarget = columnNames(config?.target);
        return chain;
      },
      onConflictDoUpdate(config: { target?: unknown; set?: unknown }) {
        op.conflictAction = "update";
        op.conflictTarget = columnNames(config.target);
        return chain;
      },
      then<TResult1 = unknown[], TResult2 = never>(
        onFulfilled?:
          ((rows: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?:
          ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve()
          .then(() => handler(op))
          .then(onFulfilled, onRejected);
      },
    };
    return chain;
  };

  const builder = {
    select(projection?: Record<string, unknown>) {
      return start("select", columnNames(projection));
    },
    insert(table: unknown) {
      const chain = start("insert");
      return chain.from(table);
    },
    update(table: unknown) {
      const chain = start("update");
      return chain.from(table);
    },
    delete(table: unknown) {
      const chain = start("delete");
      return chain.from(table);
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      state.opened += 1;
      state.depth += 1;
      try {
        return await callback(builder);
      } finally {
        state.depth -= 1;
      }
    },
  };

  return {
    db: builder,
    ops,
    get transactions() {
      return state.opened;
    },
    opsOn(table, kind) {
      return ops.filter(
        (op) => op.table === table && (kind === undefined || op.kind === kind),
      );
    },
  };
}

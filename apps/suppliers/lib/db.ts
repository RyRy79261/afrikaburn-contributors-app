import "server-only";

import { createHttpDb, createPooledDb, schema } from "@quagga/db";
import type { Database, PooledDatabase } from "@quagga/db";

/**
 * Stateless HTTP Drizzle client for the portal's route handlers, server
 * components, and single-write server actions. `@quagga/db`'s HTTP driver has no
 * transactions; reads and single-row writes (mark-read, session resolution) use
 * this hot, connection-less path.
 */
export function getDb(): Database {
  return createHttpDb();
}

/**
 * A Drizzle transaction handle — structurally the same query builder as
 * {@link Database}, but every statement inside runs in one atomic transaction.
 * Derived from the pooled driver's `transaction` callback so helpers can accept
 * either an HTTP db or a tx without duplicating query code.
 */
export type Transaction = Parameters<
  Parameters<PooledDatabase["db"]["transaction"]>[0]
>[0];

/** Anything that can run a write — the HTTP db, or a transaction. */
export type DbOrTx = Database | Transaction;

/**
 * Run `fn` inside a single pooled-WebSocket transaction and always close the
 * pool afterwards. This is the ONLY path with real transactions — multi-write
 * actions (register, profile update, onboarding step, document ack) use it so a
 * partial failure rolls every write back rather than orphaning rows. Read and
 * single-write paths must keep using {@link getDb} (the HTTP driver) so a
 * per-request pool never becomes a performance regression on the hot paths.
 */
export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { db, pool } = createPooledDb();
  try {
    return await db.transaction(fn);
  } finally {
    await pool.end();
  }
}

export { schema };

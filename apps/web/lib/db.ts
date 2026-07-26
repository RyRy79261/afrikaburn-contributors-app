import "server-only";

import { createHttpDb, createPooledDb, schema } from "@quagga/db";
import type { PooledDatabase } from "@quagga/db";
import { isDatabaseConfigured } from "./config";

/** The stateless HTTP Drizzle client (no transactions) — for route handlers and
 * server components/actions. A fresh client per call is cheap and correct for
 * the serverless HTTP driver. */
export function db() {
  return createHttpDb();
}

export { schema, isDatabaseConfigured };

/**
 * A pooled transaction handle — the argument drizzle hands to the
 * `db.transaction(async (tx) => …)` callback. Store helpers that must perform
 * their WRITES atomically accept one of these so all callers commit or roll back
 * as a unit. It is NOT the HTTP client (`db()`), which has no transactions.
 */
export type Tx = Parameters<
  Parameters<PooledDatabase["db"]["transaction"]>[0]
>[0];

/**
 * Run `fn` inside a single database transaction over the pooled (WebSocket)
 * driver, then close the pool. This is the ONLY transactional path in the app:
 * the HTTP driver (`db()`) cannot roll back, so any server action that performs
 * MULTIPLE writes which must not partially apply routes them through here.
 *
 * Reserve this for multi-write ACTIONS. Converting a hot read path to the pooled
 * driver would be a performance regression, so reads stay on `db()`.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { db: pooled, pool } = createPooledDb();
  try {
    return await pooled.transaction(fn);
  } finally {
    // Always release the socket, even if the transaction threw / rolled back.
    await pool.end();
  }
}

/** Guard for DB-backed surfaces: when unconfigured, callers render a graceful
 * "preview mode" state instead of throwing (build-spec §Hard constraints 4). */
export function requireDb(): boolean {
  return isDatabaseConfigured();
}

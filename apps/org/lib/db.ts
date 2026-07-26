import "server-only";

import { createHttpDb, createPooledDb, schema } from "@quagga/db";
import type { Database, PooledDatabase } from "@quagga/db";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Stateless HTTP Drizzle client for the console's route handlers, server
 * components, and hot READ paths. `@quagga/db`'s HTTP driver has no
 * transactions — every read in this app (and single-write mutations) uses it.
 * Multi-write server actions must NOT use this; they use `withTransaction`.
 */
export function getDb(): Database {
  return createHttpDb();
}

/**
 * A handle that accepts either the HTTP client (`getDb()`) or a pooled
 * transaction handle. Shared helpers (`writeAuditEvent`, `insertNotifications`)
 * are typed against this so the exact same call works whether it runs
 * standalone on the HTTP driver or inside a `withTransaction` block.
 *
 * Both `Database` (neon-http) and the transaction handle (neon-serverless) are
 * `PgDatabase` subtypes, so this is their common supertype for the
 * insert/update/select/delete surface these helpers use.
 */
export type DbHandle = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The transaction handle drizzle hands the `db.transaction(...)` callback. */
export type OrgTx = Parameters<
  Parameters<PooledDatabase["db"]["transaction"]>[0]
>[0];

/**
 * Run `fn` inside a single database transaction on the pooled WebSocket driver
 * (the HTTP driver has no transactions). A multi-write server action wraps its
 * writes here so a partial failure rolls the whole set back — no orphaned audit
 * rows, no activation without its required_actions, no membership without its
 * audit trail.
 *
 * This opens a short-lived pool per call and always closes it. Reserve it for
 * MUTATION actions: routing every hot read through a WebSocket pool would be a
 * performance regression, which is why reads and single-write actions stay on
 * `getDb()`.
 */
export async function withTransaction<T>(
  fn: (tx: OrgTx) => Promise<T>,
): Promise<T> {
  const { db, pool } = createPooledDb();
  try {
    return await db.transaction(fn);
  } finally {
    await pool.end();
  }
}

export { schema };

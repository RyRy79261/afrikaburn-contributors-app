import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { configureLocalProxy } from "./local-proxy";

export * as schema from "./schema";
export { configureLocalProxy } from "./local-proxy";
// What the deploy-time migration runner WOULD do, resolved from env alone. The
// org console's System panel renders this verdict so an engineer can see whether
// the deployment is set up to migrate safely without reading a build log.
export {
  connectionHost,
  isPoolerConnection,
  planMigration,
  type MigrationPlan,
} from "./migration-plan";

export type Database = NeonHttpDatabase<typeof schema>;
export type PooledDatabase = { db: NeonDatabase<typeof schema>; pool: Pool };

// `createHttpDb()` is stateless (route handlers, server components) and has NO
// transactions. `createPooledDb()` is a WebSocket pool (scripts, seeds) and
// DOES support transactions. Multi-statement atomic work must use the pool.

// Placeholder used during `next build`'s page-data collection, when real
// secrets aren't available. Any actual query will fail loudly.
const BUILD_PLACEHOLDER_URL =
  "postgres://build:build@localhost:5432/build?sslmode=disable";

function requireDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? BUILD_PLACEHOLDER_URL;
}

/**
 * HTTP driver — stateless, ideal for route handlers and server components.
 * No transactions.
 */
export function createHttpDb(): Database {
  configureLocalProxy();
  const sql = neon(requireDatabaseUrl());
  return drizzleHttp(sql, { schema });
}

/**
 * Pooled WebSocket driver — use when transactions are required (seeds, jobs).
 * Caller closes the pool on long-running processes.
 */
export function createPooledDb(): PooledDatabase {
  configureLocalProxy();
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const db = drizzleServerless(pool, { schema });
  return { db, pool };
}

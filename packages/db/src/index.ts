import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { configureLocalProxy } from "./local-proxy";

export * as schema from "./schema";
export { configureLocalProxy } from "./local-proxy";
// Shared by @quagga/auth's session-create hook AND apps/web's explicit Cancel
// button, so "signing in cancels it" and "pressing Cancel cancels it" cannot
// drift into two different behaviours.
export {
  cancelPendingDeletion,
  type CancelDeletionResult,
} from "./deletion";
// Server actions that call `auth.api.*` in-process skip Better Auth's HTTP
// limiter entirely; this is the counter that covers them.
export {
  consumeRateLimit,
  rateLimitIp,
  FORGOT_PASSWORD_MAX_PER_WINDOW,
  FORGOT_PASSWORD_WINDOW_SECONDS,
  type RateLimitVerdict,
} from "./rate-limit";
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
 *
 * ## Locally and in CI this is the WEBSOCKET driver instead. Measurements:
 *
 *     select 1, 20 times, sequentially, against the local stack
 *       SQL-over-HTTP (local-neon-http-proxy)   3041 ms   — 152 ms/statement
 *       WebSocket     (wsproxy)                   41 ms   —   2 ms/statement
 *
 * 152 ms is not Postgres and it is not the network: `curl` to the proxy shows
 * connect in 0.3 ms and first byte at 148 ms, every time. It is the dev shim,
 * which stands up a fresh backend connection per request. Neon's real HTTP
 * endpoint has no such cost, so this penalty exists ONLY in the environments
 * that don't ship.
 *
 * It was not a curiosity. Every server component read in all three apps goes
 * through this driver, so each page paid 152 ms per statement it could not
 * parallelise — and the camp dashboard, the widest read in the product, needs
 * about twenty. Measured cold 7.9 s, warm 4.0 s, on an idle 16-core machine
 * with a production build. On a 4-core CI runner also hosting three Next
 * servers, Postgres and two proxies, it went past Playwright's 20 s navigation
 * cap: all 37 navigation timeouts across the whole e2e fleet on 28 Jul were
 * `/camps/[slug]` (32) or its `settings/roles` child (5), and NOTHING else
 * timed out. It read for a week as a flaky suite, or an underpowered runner, or
 * a product bug in one page. It was a dev proxy.
 *
 * So under `NEON_LOCAL_PROXY=1` — set by scripts/e2e-local.sh and nothing that
 * deploys — reads go over the WebSocket proxy on one shared pool. Same drizzle
 * API, same SQL, same results; only the transport differs, and it is the
 * transport that was lying. Production is untouched: without that variable this
 * is the HTTP driver exactly as before.
 *
 * `allowExitOnIdle` so a short script (the god bootstrap, a seed) still exits
 * when its work is done instead of being held open by an idle pool.
 */
export function createHttpDb(): Database {
  configureLocalProxy();
  if (process.env.NEON_LOCAL_PROXY === "1") {
    localReadPool ??= makeLocalReadPool();
    // The two drivers' query builders are the same API; `execute()` is the one
    // place their return shapes differ (rows array vs pg Result). Two callers:
    // rate-limit.ts, which handles both shapes deliberately, and
    // apps/org/lib/system-probe.ts, which awaits `select 1` and discards the
    // result — so neither can see the difference.
    return drizzleServerless(localReadPool, {
      schema,
      logger: sqlLogger(),
    }) as unknown as Database;
  }
  const sql = neon(requireDatabaseUrl());
  return drizzleHttp(sql, { schema, logger: sqlLogger() });
}

/** Process-wide, so `db()` per query costs nothing after the first. */
let localReadPool: Pool | undefined;

function makeLocalReadPool(): Pool {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: 10,
    allowExitOnIdle: true,
  });
  // An error on an IDLE pooled client is emitted on the pool, and an unhandled
  // 'error' event takes the process down. A dropped local connection must not
  // kill the dev server.
  pool.on("error", (err: Error) => {
    console.warn("[db] local read pool client error (ignored):", err.message);
  });
  return pool;
}

/**
 * Opt-in per-statement logging, off unless `QUAGGA_SQL_LOG=1`.
 *
 * Kept because "which page is slow" and "why is that page slow" are different
 * questions, and only this answers the second. The 28 Jul CI investigation
 * burned a whole cycle on the first: every e2e timeout in the fleet was one
 * page, and reading the code around it produced three plausible theories and no
 * evidence. Counting the statements one render actually issues settled it in a
 * single run. Prefix is greppable on purpose (`grep -c '\[sql\]'`).
 */
function sqlLogger(): { logQuery(query: string, params: unknown[]): void } | undefined {
  if (process.env.QUAGGA_SQL_LOG !== "1") return undefined;
  return {
    logQuery(query: string) {
      console.log(`[sql] ${query.replace(/\s+/g, " ").slice(0, 160)}`);
    },
  };
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

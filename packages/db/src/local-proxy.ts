import { neonConfig } from "@neondatabase/serverless";

/**
 * Point the Neon drivers at LOCAL proxies instead of Neon's cloud endpoint, so
 * the whole stack can run against a plain Postgres (docker-compose.local.yml).
 *
 * THE PROXY ADDRESS IS FIXED AND LOCAL, deliberately independent of the host in
 * `DATABASE_URL`. Those two hosts are resolved by different parties: the
 * connection string's host is resolved by the PROXY (inside the compose
 * network, where the database is `postgres`), while the proxy endpoint is
 * resolved by THIS process (on the host, where it is `localhost`). Deriving the
 * proxy address from the connection-string host — the previous shape — conflates
 * them, so either the proxy cannot reach the database or we cannot reach the
 * proxy. There is no single hostname that satisfies both.
 *
 * TWO endpoints, because `@neondatabase/serverless` speaks two protocols and no
 * single local proxy implements both: SQL-over-HTTP (`/sql`) for the stateless
 * driver that every route handler and server component reads through, and
 * WebSocket (`/v1`) for the pooled/transactional driver.
 *
 * This lives in its own module so `index.ts` and `migrate.ts` share ONE
 * definition. They previously kept separate copies, and the copies drifted: the
 * migrator and the pooled driver were configured while the HTTP driver was not,
 * which made a local run impossible in a way nothing reported.
 */
export function configureLocalProxy(): void {
  if (process.env.NEON_LOCAL_PROXY !== "1") return;
  const host = process.env.NEON_LOCAL_PROXY_HOST ?? "localhost";
  const wsPort = process.env.NEON_LOCAL_WS_PORT ?? "5433";
  const httpPort = process.env.NEON_LOCAL_HTTP_PORT ?? "4444";
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = () => `${host}:${wsPort}/v1`;
  neonConfig.fetchEndpoint = () => `http://${host}:${httpPort}/sql`;
  // The proxies terminate TLS themselves; the driver must not also try to.
  neonConfig.pipelineConnect = false;
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { neonConfig } from "@neondatabase/serverless";
import { configureLocalProxy } from "../local-proxy";

// `neonConfig` is PROCESS-GLOBAL and shared with every other test file in this
// package, so it is snapshotted and put back after each case. Leaving a
// localhost proxy configured would silently re-point whatever ran next.
const SNAPSHOT = {
  wsProxy: neonConfig.wsProxy,
  fetchEndpoint: neonConfig.fetchEndpoint,
  useSecureWebSocket: neonConfig.useSecureWebSocket,
  pipelineConnect: neonConfig.pipelineConnect,
};

const ENV_KEYS = [
  "NEON_LOCAL_PROXY",
  "NEON_LOCAL_PROXY_HOST",
  "NEON_LOCAL_WS_PORT",
  "NEON_LOCAL_HTTP_PORT",
  "DATABASE_URL",
] as const;
const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

/** The proxies are configured as callbacks; resolve whichever form is set. */
function wsProxy(): string | undefined {
  const value = neonConfig.wsProxy;
  return typeof value === "function" ? value("db.internal", 5432) : value;
}
function fetchEndpoint(): string | undefined {
  const value = neonConfig.fetchEndpoint;
  return typeof value === "function" ? value("db.internal", 5432) : value;
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  Object.assign(neonConfig, SNAPSHOT);
  for (const key of ENV_KEYS) {
    const original = ENV_SNAPSHOT[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("configureLocalProxy — the opt-in gate", () => {
  it("leaves neonConfig COMPLETELY untouched unless NEON_LOCAL_PROXY is exactly '1'", () => {
    // A truthy check here would re-point a DEPLOYED app at localhost the moment
    // the variable existed with any value at all — including "0" and "false".
    for (const value of [undefined, "0", "true", "yes", "", "01"]) {
      if (value === undefined) delete process.env.NEON_LOCAL_PROXY;
      else process.env.NEON_LOCAL_PROXY = value;
      configureLocalProxy();
      expect(neonConfig.wsProxy).toBe(SNAPSHOT.wsProxy);
      expect(neonConfig.fetchEndpoint).toBe(SNAPSHOT.fetchEndpoint);
      expect(neonConfig.useSecureWebSocket).toBe(SNAPSHOT.useSecureWebSocket);
      expect(neonConfig.pipelineConnect).toBe(SNAPSHOT.pipelineConnect);
    }
  });
});

describe("configureLocalProxy — the two endpoints", () => {
  beforeEach(() => {
    process.env.NEON_LOCAL_PROXY = "1";
  });

  it("defaults to the compose stack's ports", () => {
    // Two endpoints because @neondatabase/serverless speaks two protocols and
    // no single local proxy implements both: WebSocket (/v1) for the pooled and
    // transactional driver, SQL-over-HTTP (/sql) for the stateless one.
    configureLocalProxy();
    expect(wsProxy()).toBe("localhost:5433/v1");
    expect(fetchEndpoint()).toBe("http://localhost:4444/sql");
  });

  it("honours the host and EACH port independently", () => {
    // Three distinct values on purpose. A copy-paste that read the WS port for
    // the HTTP endpoint yields a stack where the transactional half works and
    // the read half does not — which is exactly the drift this module was
    // extracted to prevent, and it reports nothing when it happens.
    process.env.NEON_LOCAL_PROXY_HOST = "127.0.0.1";
    process.env.NEON_LOCAL_WS_PORT = "15433";
    process.env.NEON_LOCAL_HTTP_PORT = "14444";
    configureLocalProxy();
    expect(wsProxy()).toBe("127.0.0.1:15433/v1");
    expect(fetchEndpoint()).toBe("http://127.0.0.1:14444/sql");
  });

  it("ignores DATABASE_URL's host entirely", () => {
    // THE POINT OF THE MODULE. The connection string's host is resolved by the
    // PROXY, inside the compose network, where the database is `postgres`. The
    // proxy endpoint is resolved by THIS process, on the host, where it is
    // `localhost`. Deriving one from the other — the previous shape — means
    // either the proxy cannot reach the database or we cannot reach the proxy.
    // There is no single hostname that satisfies both.
    process.env.DATABASE_URL = "postgres://u:p@postgres:5432/quagga";
    configureLocalProxy();
    expect(wsProxy()).toBe("localhost:5433/v1");
    expect(fetchEndpoint()).toBe("http://localhost:4444/sql");
    expect(wsProxy()).not.toContain("postgres:");
  });

  it("turns OFF the driver's own TLS and connection pipelining", () => {
    // The proxies terminate TLS themselves; a driver that also tries produces a
    // handshake failure that reads as "the database is down".
    configureLocalProxy();
    expect(neonConfig.useSecureWebSocket).toBe(false);
    expect(neonConfig.pipelineConnect).toBe(false);
  });
});

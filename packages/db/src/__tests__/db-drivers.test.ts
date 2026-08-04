import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { neonConfig, Pool } from "@neondatabase/serverless";

// index.ts keeps a PROCESS-WIDE local read pool in module state, so every case
// here re-imports the module fresh. Without that, "the pool is reused" and "a
// fresh env picks a different driver" would fight each other depending on order.
async function freshIndex() {
  vi.resetModules();
  return import("../index");
}

const ENV_KEYS = ["DATABASE_URL", "NEON_LOCAL_PROXY", "QUAGGA_SQL_LOG"] as const;
const ENV_SNAPSHOT = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const NEON_SNAPSHOT = {
  wsProxy: neonConfig.wsProxy,
  fetchEndpoint: neonConfig.fetchEndpoint,
  useSecureWebSocket: neonConfig.useSecureWebSocket,
  pipelineConnect: neonConfig.pipelineConnect,
};

/** Pools opened by a test, ended afterwards so vitest does not hang on them. */
const opened: Pool[] = [];

/**
 * The logger drizzle actually installed on the session.
 *
 * Read off the driver rather than from a mocked config on purpose: the claim is
 * that `QUAGGA_SQL_LOG` reaches the thing that logs queries, not merely that a
 * factory returned an object.
 */
function installedLogger(db: unknown): { logQuery(query: string, params: unknown[]): void } {
  return (db as { session: { logger: { logQuery(q: string, p: unknown[]): void } } })
    .session.logger;
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(async () => {
  for (const pool of opened.splice(0)) await pool.end();
  Object.assign(neonConfig, NEON_SNAPSHOT);
  for (const key of ENV_KEYS) {
    const original = ENV_SNAPSHOT[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.restoreAllMocks();
});

describe("env-less construction (AGENTS.md rule 4)", () => {
  it("builds BOTH drivers with no database env at all", async () => {
    // All three apps must boot env-less to a graceful "not configured" state.
    // These factories run during `next build`'s page-data collection, before
    // any secret exists, so a throw here is a build failure in every app — not
    // a runtime error somebody sees once. Only an actual query may fail.
    const { createHttpDb, createPooledDb } = await freshIndex();

    expect(() => createHttpDb()).not.toThrow();
    const { db, pool } = createPooledDb();
    opened.push(pool);
    expect(db).toBeTruthy();
    // A pool that never connected still closes cleanly — the caller's own
    // `finally { pool.end() }` must not become the error it was guarding.
    await expect(pool.end()).resolves.toBeUndefined();
    opened.pop();
  });
});

describe("the NEON_LOCAL_PROXY transport switch", () => {
  it("reads over the stateless HTTP driver by default", async () => {
    // Production and every deploy. `$client` is neon()'s tagged-template
    // function here, not a pool.
    const { createHttpDb } = await freshIndex();
    const client = (createHttpDb() as unknown as { $client: unknown }).$client;
    expect(typeof client).toBe("function");
    expect(client).not.toBeInstanceOf(Pool);
  });

  it("swaps to a WebSocket POOL under NEON_LOCAL_PROXY=1", async () => {
    // THE 28 JUL INCIDENT. The local SQL-over-HTTP dev shim stands up a fresh
    // backend connection per request: measured 152 ms per statement against
    // 2 ms over the WebSocket proxy. The camp dashboard issues about twenty, so
    // it blew past Playwright's 20 s navigation cap — all 37 navigation
    // timeouts in the e2e fleet were that page or its child, and NOTHING else
    // timed out. It read for a week as a flaky suite. Only the transport
    // differs; same drizzle API, same SQL, same results.
    process.env.NEON_LOCAL_PROXY = "1";
    const { createHttpDb } = await freshIndex();
    const client = (createHttpDb() as unknown as { $client: Pool }).$client;
    opened.push(client);
    expect(client).toBeInstanceOf(Pool);
  });

  it("creates that pool ONCE and reuses it", async () => {
    // A per-call pool would open a fresh connection per query and undo the
    // entire fix above.
    process.env.NEON_LOCAL_PROXY = "1";
    const { createHttpDb } = await freshIndex();
    const first = (createHttpDb() as unknown as { $client: Pool }).$client;
    const second = (createHttpDb() as unknown as { $client: Pool }).$client;
    opened.push(first);
    expect(second).toBe(first);
  });

  it("swallows an 'error' event on the local read pool instead of dying", async () => {
    // An unhandled 'error' on a pg pool takes the PROCESS down, and this pool
    // is process-wide — a dropped local connection would kill the dev server
    // mid-session, in a way that looks like the app crashed.
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEON_LOCAL_PROXY = "1";
    const { createHttpDb } = await freshIndex();
    const pool = (createHttpDb() as unknown as { $client: Pool }).$client;
    opened.push(pool);

    expect(() => pool.emit("error", new Error("connection terminated unexpectedly"))).not.toThrow();
    expect(warned).toHaveBeenCalledOnce();
    const message = String(warned.mock.calls[0]?.[0]);
    expect(message).toContain("[db]");
    expect(String(warned.mock.calls[0]?.[1])).toContain("connection terminated");
  });
});

describe("QUAGGA_SQL_LOG", () => {
  it("logs nothing unless the variable is exactly '1'", async () => {
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const value of [undefined, "0", "true"]) {
      if (value === undefined) delete process.env.QUAGGA_SQL_LOG;
      else process.env.QUAGGA_SQL_LOG = value;
      const { createHttpDb } = await freshIndex();
      installedLogger(createHttpDb()).logQuery("select 1", []);
    }
    expect(printed).not.toHaveBeenCalled();
  });

  it("prints one greppable, whitespace-collapsed, truncated line per statement", async () => {
    // "Which page is slow" and "why is that page slow" are different questions
    // and only this answers the second: counting the statements one render
    // issues settled the 28 Jul investigation in a single run, after three
    // plausible theories from reading the code alone. One line per statement,
    // so `grep -c '\[sql\]'` is the count.
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.QUAGGA_SQL_LOG = "1";
    const { createHttpDb } = await freshIndex();

    const query = `select\n  "users"."id",\n  "users"."email"\nfrom "users"\nwhere ${"x".repeat(300)}`;
    installedLogger(createHttpDb()).logQuery(query, ["param"]);

    expect(printed).toHaveBeenCalledOnce();
    const line = String(printed.mock.calls[0]?.[0]);
    expect(line.startsWith("[sql] ")).toBe(true);
    expect(line).not.toContain("\n");
    expect(line).toContain('select "users"."id", "users"."email" from "users"');
    // 160 characters of query, so one statement cannot flood a build log.
    expect(line).toHaveLength("[sql] ".length + 160);
  });
});

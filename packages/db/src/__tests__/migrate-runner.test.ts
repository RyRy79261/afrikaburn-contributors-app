import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The deploy-time runner, driven with the pool, the migrator and the seed all
// mocked. What that proves is ORDER and BRANCH: one client, the same client for
// the lock and the migration, the timeouts before the lock and lifted after it,
// the cleanup on the failure path, and bootstrap-vs-repair.
//
// What it CANNOT prove — and this file is not evidence of it — is the advisory
// lock's semantics: that `pg_advisory_lock` actually serialises two concurrent
// Vercel builders. That needs two live Postgres sessions. The unit test pins
// the shape of the claim; only a real database can test the claim itself.
const h = vi.hoisted(() => {
  const state = {
    editionRowCount: 0,
    queries: [] as { text: string; args: unknown[] }[],
    poolsCreated: 0,
    clientsCheckedOut: 0,
    released: 0,
    poolsEnded: 0,
    unlockFails: false,
  };
  const client = {
    async query(text: string, args: unknown[] = []) {
      state.queries.push({ text, args });
      if (state.unlockFails && text.includes("pg_advisory_unlock")) {
        throw new Error("unlock failed: connection already gone");
      }
      if (/FROM editions/i.test(text)) {
        return { rowCount: state.editionRowCount, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => {
      state.released += 1;
    },
  };
  return {
    state,
    client,
    migrate: vi.fn(async () => {}),
    drizzle: vi.fn((c: unknown) => ({ handedTo: c })),
    seedReferenceData: vi.fn(async () => {}),
    ensureSeededOrgRoles: vi.fn(async () => 0),
    ensureSeededOrgDepartments: vi.fn(async () => 0),
  };
});

vi.mock("@neondatabase/serverless", () => {
  class Pool {
    constructor(_config: { connectionString: string }) {
      h.state.poolsCreated += 1;
    }
    async connect() {
      h.state.clientsCheckedOut += 1;
      return h.client;
    }
    async end() {
      h.state.poolsEnded += 1;
    }
  }
  // local-proxy.ts reaches for this; it is a no-op without NEON_LOCAL_PROXY.
  return { Pool, neonConfig: {} };
});
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: h.drizzle }));
vi.mock("drizzle-orm/neon-serverless/migrator", () => ({ migrate: h.migrate }));
vi.mock("../seed", () => ({
  seedReferenceData: h.seedReferenceData,
  ensureSeededOrgRoles: h.ensureSeededOrgRoles,
  ensureSeededOrgDepartments: h.ensureSeededOrgDepartments,
}));

import { runDeployMigrations } from "../migrate";

const DIRECT =
  "postgres://user:pw@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=require";

const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "VERCEL_ENV",
  "VERCEL",
  "NEON_LOCAL_PROXY",
] as const;
const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

/** Index of the first recorded query matching `needle`, or -1. */
function queryIndex(needle: string | RegExp): number {
  return h.state.queries.findIndex(({ text }) =>
    typeof needle === "string" ? text.includes(needle) : needle.test(text),
  );
}
const queryTexts = () => h.state.queries.map((q) => q.text);

beforeEach(() => {
  vi.clearAllMocks();
  h.ensureSeededOrgRoles.mockResolvedValue(0);
  Object.assign(h.state, {
    editionRowCount: 0,
    queries: [],
    poolsCreated: 0,
    clientsCheckedOut: 0,
    released: 0,
    poolsEnded: 0,
    unlockFails: false,
  });
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.DATABASE_URL_UNPOOLED = DIRECT;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ENV_SNAPSHOT[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.restoreAllMocks();
});

describe("runDeployMigrations — the env-less build", () => {
  it("returns BEFORE constructing a pool when there is nothing to migrate", async () => {
    // AGENTS.md rule 4. A DB-less build must exit 0, and reaching for a
    // connection first would fail the build of all three apps on a fork.
    for (const key of ENV_KEYS) delete process.env[key];
    await expect(runDeployMigrations()).resolves.toBeUndefined();
    expect(h.state.poolsCreated).toBe(0);
    expect(h.migrate).not.toHaveBeenCalled();
  });

  it("warns loudly when it falls back to DATABASE_URL off-deploy", async () => {
    // Convenient for local dev, but it must never be quiet: the fallback is the
    // shape that double-seeded the real database once already.
    const warned = vi.spyOn(console, "log");
    delete process.env.DATABASE_URL_UNPOOLED;
    process.env.DATABASE_URL = DIRECT;
    await runDeployMigrations();
    expect(warned.mock.calls.flat().join(" ")).toContain(
      "DATABASE_URL_UNPOOLED is not set",
    );
  });
});

describe("runDeployMigrations — the advisory lock", () => {
  it("checks out ONE client and gives that SAME client to the migrator", async () => {
    // The file's central claim. A lock taken on a different connection than the
    // migration protects nothing at all, and the failure is invisible: both
    // statements succeed, and two builders migrate concurrently anyway.
    await runDeployMigrations();
    expect(h.state.clientsCheckedOut).toBe(1);
    expect(queryIndex("pg_advisory_lock")).toBeGreaterThanOrEqual(0);
    expect(h.drizzle).toHaveBeenCalledWith(h.client);
    expect(h.migrate).toHaveBeenCalledWith(
      { handedTo: h.client },
      expect.objectContaining({
        migrationsFolder: expect.stringContaining("migrations"),
      }),
    );
  });

  it("bounds the WAIT and then unbounds the MIGRATION", async () => {
    // Reversing these is a real hazard in both directions: an unbounded wait
    // hangs a Vercel build on an orphaned lock for its whole build budget, and a
    // bounded migration aborts a long legitimate one halfway through.
    await runDeployMigrations();
    const lock = queryIndex("pg_advisory_lock");
    expect(queryIndex("SET lock_timeout")).toBeLessThan(lock);
    expect(queryIndex(/SET statement_timeout = \d+00/)).toBeLessThan(lock);
    expect(queryIndex("SET statement_timeout = 0")).toBeGreaterThan(lock);
  });

  it("uses one FIXED lock key — identity across apps is what serialises them", async () => {
    await runDeployMigrations();
    const lock = h.state.queries[queryIndex("pg_advisory_lock")];
    const unlock = h.state.queries[queryIndex("pg_advisory_unlock")];
    expect(lock?.args).toEqual(unlock?.args);
    expect(lock?.args?.[0]).toBe(42_97_2027);
  });

  it("unlocks, releases the client AND ends the pool when the migration fails", async () => {
    // A stranded lock blocks every subsequent deploy of all three apps until
    // somebody notices.
    h.migrate.mockRejectedValueOnce(new Error("relation already exists"));
    await expect(runDeployMigrations()).rejects.toThrow(
      /relation already exists/,
    );
    expect(queryTexts().some((t) => t.includes("pg_advisory_unlock"))).toBe(
      true,
    );
    expect(h.state.released).toBe(1);
    expect(h.state.poolsEnded).toBe(1);
  });

  it("swallows a failing unlock without masking the original error", async () => {
    // Session locks release on disconnect regardless, so an unlock that throws
    // is a warning. Letting it propagate would replace the real cause of the
    // failed deploy with a cleanup error.
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.state.unlockFails = true;
    h.migrate.mockRejectedValueOnce(new Error("relation already exists"));
    await expect(runDeployMigrations()).rejects.toThrow(
      /relation already exists/,
    );
    expect(warned).toHaveBeenCalled();
    expect(h.state.poolsEnded).toBe(1);
  });
});

describe("runDeployMigrations — bootstrap versus repair", () => {
  it("seeds inside a transaction when there is no edition", async () => {
    h.state.editionRowCount = 0;
    await runDeployMigrations();
    expect(h.seedReferenceData).toHaveBeenCalledOnce();
    const texts = queryTexts();
    expect(texts).toContain("BEGIN");
    expect(texts).toContain("COMMIT");
    expect(texts).not.toContain("ROLLBACK");
  });

  it("ROLLS BACK and rethrows when the seed fails — never a half-seeded database", async () => {
    // The sentinel is "does an edition exist", and the seed's own first write is
    // what creates one. An unwrapped seed that died halfway left an edition
    // behind with the org group missing, so every LATER deploy read the
    // sentinel, concluded "already seeded" and skipped the repair. The database
    // was permanently half-built with no in-product way out: resolveOrgSurface
    // finds no org group and the console is unreachable.
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.state.editionRowCount = 0;
    h.seedReferenceData.mockRejectedValueOnce(
      new Error("supplier import failed"),
    );
    await expect(runDeployMigrations()).rejects.toThrow(
      /supplier import failed/,
    );
    const texts = queryTexts();
    expect(texts).toContain("ROLLBACK");
    expect(texts).not.toContain("COMMIT");
    expect(h.state.poolsEnded).toBe(1);
  });

  it("does NOT re-seed an existing database, but DOES restore the org roles and departments", async () => {
    // "This is a bootstrap, not a sync." Camp categories and supplier records
    // are editable in the org console, and re-asserting canonical rows every
    // deploy would revert an organiser's edits. The two ensure* calls are the
    // exception, and they are insert-if-missing: a database that predates org
    // roles v1 would otherwise come up with empty role tables and lock out
    // every org_staff and engineer account on the deploy that ships the feature.
    h.state.editionRowCount = 1;
    await runDeployMigrations();
    expect(h.seedReferenceData).not.toHaveBeenCalled();
    expect(queryTexts()).not.toContain("BEGIN");
    expect(h.ensureSeededOrgDepartments).toHaveBeenCalledOnce();
    expect(h.ensureSeededOrgRoles).toHaveBeenCalledOnce();
  });

  it("reports how many org roles it actually restored", async () => {
    // The log line is the only signal an engineer gets that a repair happened.
    const logged = vi.spyOn(console, "log");
    h.state.editionRowCount = 1;
    h.ensureSeededOrgRoles.mockResolvedValueOnce(2);
    await runDeployMigrations();
    expect(logged.mock.calls.flat().join(" ")).toContain(
      "seeded 2 missing org role(s)",
    );

    logged.mockClear();
    h.ensureSeededOrgRoles.mockResolvedValueOnce(0);
    await runDeployMigrations();
    expect(logged.mock.calls.flat().join(" ")).toContain("org roles present");
  });
});

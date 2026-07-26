import { describe, it, expect } from "vitest";
import {
  connectionHost,
  isPoolerConnection,
  planMigration,
} from "../migrate";

const DIRECT =
  "postgres://user:pw@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=require";
const POOLED =
  "postgres://user:pw@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=require";

describe("isPoolerConnection", () => {
  it("flags the Neon -pooler host suffix", () => {
    expect(isPoolerConnection(POOLED)).toBe(true);
  });

  it("flags an explicit pgbouncer=true query flag", () => {
    expect(
      isPoolerConnection(`${DIRECT.split("?")[0]}?pgbouncer=true`),
    ).toBe(true);
  });

  it("flags a pgbouncer host", () => {
    expect(
      isPoolerConnection("postgres://u:p@pgbouncer.internal:6432/db"),
    ).toBe(true);
  });

  it("does not flag the direct/unpooled host", () => {
    expect(isPoolerConnection(DIRECT)).toBe(false);
  });

  it("does not throw on an unparseable string", () => {
    expect(isPoolerConnection("not a url")).toBe(false);
  });
});

describe("connectionHost", () => {
  it("returns the hostname without credentials", () => {
    expect(connectionHost(POOLED)).toBe(
      "ep-cool-name-123456-pooler.us-east-2.aws.neon.tech",
    );
  });

  it("returns null for an unparseable string", () => {
    expect(connectionHost("nonsense")).toBeNull();
  });
});

describe("planMigration", () => {
  it("skips (exit 0) when no DB is configured outside production", () => {
    const plan = planMigration({} as NodeJS.ProcessEnv);
    expect(plan.kind).toBe("skip");
  });

  it("skips in a non-production Vercel context with no DB (preview/CI)", () => {
    const plan = planMigration({
      VERCEL_ENV: "preview",
    } as NodeJS.ProcessEnv);
    expect(plan.kind).toBe("skip");
  });

  it("FAILS HARD in production when no DB is configured", () => {
    expect(() =>
      planMigration({ VERCEL_ENV: "production" } as NodeJS.ProcessEnv),
    ).toThrow(/PRODUCTION DEPLOY with no database/);
  });

  it("runs against the unpooled URL when it is set", () => {
    const plan = planMigration({
      DATABASE_URL_UNPOOLED: DIRECT,
      DATABASE_URL: POOLED,
      VERCEL_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(plan).toEqual({
      kind: "run",
      connectionString: DIRECT,
      usingUnpooled: true,
    });
  });

  it("ABORTS on a pooled endpoint regardless of environment (the core bug)", () => {
    expect(() =>
      planMigration({ DATABASE_URL: POOLED } as NodeJS.ProcessEnv),
    ).toThrow(/POOLED \(PgBouncer\) endpoint/);
  });

  it("ABORTS in production when only DATABASE_URL is set, even if its host is not an obvious pooler", () => {
    expect(() =>
      planMigration({
        DATABASE_URL: DIRECT,
        VERCEL_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DEPLOY without DATABASE_URL_UNPOOLED/);
  });

  // REGRESSION — this exact gap double-seeded the real database.
  //
  // The fallback refusal used to be scoped to `VERCEL_ENV === "production"`, so
  // a PREVIEW build with no DATABASE_URL_UNPOOLED silently used DATABASE_URL.
  // Neon's Vercel integration points that at the pooled endpoint, whose host
  // string does not reliably say "pooler", so `isPoolerConnection` waved it
  // through — and a session advisory lock on a transaction-pooling connection
  // does not hold. Two builders each took a lock that protected nothing, both
  // saw an empty `editions`, and both seeded: 40 suppliers instead of 20.
  //
  // The hazard was never specific to production. Only the guard was.
  it("ABORTS on a PREVIEW deploy without DATABASE_URL_UNPOOLED", () => {
    for (const env of [
      { DATABASE_URL: DIRECT, VERCEL_ENV: "preview" },
      { DATABASE_URL: DIRECT, VERCEL_ENV: "development" },
      { DATABASE_URL: DIRECT, VERCEL: "1" },
    ]) {
      expect(() => planMigration(env as NodeJS.ProcessEnv)).toThrow(
        /DEPLOY without DATABASE_URL_UNPOOLED/,
      );
    }
  });

  it("still RUNS on a deploy when DATABASE_URL_UNPOOLED is present", () => {
    const plan = planMigration({
      DATABASE_URL: POOLED,
      DATABASE_URL_UNPOOLED: DIRECT,
      VERCEL_ENV: "preview",
    } as NodeJS.ProcessEnv);
    expect(plan).toEqual({
      kind: "run",
      connectionString: DIRECT,
      usingUnpooled: true,
    });
  });

  // Off Vercel entirely (a laptop, CI without the VERCEL vars): still falls back,
  // because there is no concurrent-builder hazard to serialise against.
  it("warns-and-falls-back (runs) OFF-DEPLOY when DATABASE_URL host is not a pooler", () => {
    const plan = planMigration({
      DATABASE_URL: DIRECT,
    } as NodeJS.ProcessEnv);
    expect(plan).toEqual({
      kind: "run",
      connectionString: DIRECT,
      usingUnpooled: false,
    });
  });

  it("permits a pooler-looking host only under NEON_LOCAL_PROXY (dev proxy)", () => {
    const plan = planMigration({
      DATABASE_URL: POOLED,
      NEON_LOCAL_PROXY: "1",
    } as NodeJS.ProcessEnv);
    expect(plan.kind).toBe("run");
  });
});

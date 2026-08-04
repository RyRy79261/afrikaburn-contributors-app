import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "@/lib/db";

// The portal's two database handles (lib/db.ts).
//
// Only `getDb` is exercised here, and deliberately so: `withTransaction` opens
// a real pooled WebSocket connection via `createPooledDb` and calls
// `pool.end()`, so it needs a live Postgres. That is out of scope for this
// suite — there is no database available — and `pnpm e2e:local` is where the
// transactional paths (register, profile update, onboarding step, document ack)
// are actually proven. Roughly four lines and one function stay permanently
// dark in this file; that is an honest gap, not grounds for excluding it.
//
// What IS worth pinning is that `getDb()` CONSTRUCTS with no env at all. Hard
// engineering rule 4: all three apps must boot env-less to a graceful "not
// configured" state. A driver that threw on construction would take out the
// landing and sign-in screens, which are exactly the pages that must render
// when nothing else is configured — and the guard callers rely on
// (`isDatabaseConfigured`) is checked BEFORE any query, not before this call.

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("NEON_LOCAL_PROXY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDb", () => {
  it("constructs with no DATABASE_URL set at all", () => {
    // The driver falls back to a build placeholder URL rather than throwing.
    // Nothing connects until a query runs, and nothing queries without
    // `isDatabaseConfigured()`.
    expect(() => getDb()).not.toThrow();
  });

  it("hands back a query builder bound to the shared schema", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://quagga:secret@stub.neon.tech/quagga",
    );

    const db = getDb();
    const query = db
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .toSQL();

    // Building the statement touches no connection — this asserts the handle is
    // real drizzle over the real schema, not that anything was executed.
    expect(query.sql).toContain('from "suppliers"');
  });
});

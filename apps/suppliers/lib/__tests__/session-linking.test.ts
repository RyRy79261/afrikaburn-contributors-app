import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, pgTimestamp, type FakeDb } from "@/test/fakes/db";
import type { AuthenticatedUser } from "@/lib/auth";

// Portal session resolution and the supplier email-overlap CLAIM
// (lib/session.ts).
//
// `resolveSupplierForUser` is the ONLY writer of `suppliers.user_id` on an
// existing row anywhere in this codebase — nothing in the org console links or
// unlinks a listing. So this function alone decides who takes over a business's
// onboarding, documents, standing and the org's internal correspondence.
//
// A SUBSTRING MATCH HERE WAS A LIVE TAKEOVER. `suppliers.contact` is prose full
// of webmail addresses, so `ILIKE '%address%'` on its own meant:
//   contact "Lenny deharnstretchtents85@gmail.com"
//     → register harnstretchtents85@gmail.com, verify it, own that supplier.
// The shorter address is a literal substring of the longer one and both are
// ordinary registerable Gmail addresses. `contactNamesAddress` (@quagga/core)
// is what closes it; the ILIKE is now only a prefilter, and nothing else
// currently proves that ordering still holds.
//
// The fake handle compiles real drizzle SQL (test/fakes/db.ts). Postgres' own
// ILIKE semantics and the `ON CONFLICT` de-duplication are asserted here only
// as intent — `pnpm e2e:local` proves the rest.

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const { getAuthenticatedUser } = await import("@/lib/auth");
const { resolveSupplierSession, requireSupplierSession } =
  await import("@/lib/session");

const VERIFIED: AuthenticatedUser = {
  id: "auth-alice",
  primaryEmail: "harnstretchtents85@gmail.com",
  displayName: "Alice Hatter",
  emailVerified: true,
};

/** The columns `resolveSupplierForUser` projects, as a whole listing row. */
function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "sup-1",
    name: "Harn Stretch Tents",
    code: "SUP-2027-0416",
    services: "Stretch tents",
    contact: "Lenny deharnstretchtents85@gmail.com",
    website: null,
    category: "Structures",
    returning: null,
    standing: "good",
    ...overrides,
  };
}

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  // The real `isDatabaseConfigured()` reads this — no mock, so the env-less
  // branch below is the one the app actually takes.
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
  vi.mocked(getAuthenticatedUser).mockResolvedValue(VERIFIED);
  db.rows("users", [
    { id: "user-alice", email: VERIFIED.primaryEmail, sanitizedAt: null },
  ]);
  db.rows("editions", [{ id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the email-overlap claim", () => {
  it("REFUSES a shorter address that is merely a substring of the contact's", async () => {
    // THE TAKEOVER. "harnstretchtents85@gmail.com" appears inside
    // "deharnstretchtents85@gmail.com", so the ILIKE prefilter returns the row.
    // The decision belongs to `contactNamesAddress`, which compares whole
    // address tokens — and it must say no.
    db.rows("suppliers", [], [listing()]);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("unlinked");
    // The load-bearing half: no `user_id` was written to anybody's row.
    expect(db.matching('update "suppliers" set')).toEqual([]);
    expect(db.matching('insert into "audit_events"')).toEqual([]);
  });

  it("claims a WHOLE-address match, writing user_id and an audit event", async () => {
    db.rows(
      "suppliers",
      [], // nothing linked to this account yet
      [listing({ contact: "Lenny · harnstretchtents85@gmail.com" })],
    );
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("audit_events", []);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("ok");

    const claim = db.matching('update "suppliers" set')[0]!;
    expect(claim.params).toContain("user-alice");
    // Re-checked in the WHERE: two concurrent sign-ins must not both claim it.
    expect(claim.sql).toContain('"suppliers"."user_id" is null');
    expect(claim.params).toContain("sup-1");

    const audit = db.matching('insert into "audit_events"')[0]!;
    expect(audit.params).toContain("supplier.link");
    expect(audit.params).toContain("sup-1");
    expect(String(audit.params.at(-1))).toContain("email_overlap");
  });

  it("never claims a row for an UNVERIFIED email, however well it matches", async () => {
    // An asserted-but-unverified address is just a string somebody typed.
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      ...VERIFIED,
      emailVerified: false,
    });
    db.rows("suppliers", []);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("unlinked");
    // Not merely "did not claim": the candidate scan never even ran.
    expect(db.matching("ilike")).toEqual([]);
  });

  it("escapes LIKE wildcards, so an underscore cannot widen the pattern", async () => {
    // `_` matches any single character in LIKE and is a common email local-part
    // character. Unescaped, `a_b@x.com` also prefilters `axb@x.com`.
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      ...VERIFIED,
      primaryEmail: "a_b%c@x.com",
    });
    db.rows("suppliers", [], []);

    await resolveSupplierSession();

    const scan = db.matching("ilike")[0]!;
    expect(scan.params).toContain("%a\\_b\\%c@x.com%");
  });

  it("claims the OLDEST candidate, so a repeat sign-in claims the same row", async () => {
    db.rows("suppliers", [], []);

    await resolveSupplierSession();

    const scan = db.matching("ilike")[0]!;
    expect(scan.sql).toContain(
      'order by "suppliers"."created_at" asc, "suppliers"."id" asc',
    );
    // Bounded: an address inside more than twenty different suppliers' contact
    // strings is not an identity, it is a red flag.
    expect(scan.params).toContain(20);
  });

  it("short-circuits on an already-linked row, before any email matching", async () => {
    db.rows("suppliers", [listing({ contact: null })]);
    db.rows("supplier_onboarding", [{ steps: {} }]);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("ok");
    expect(db.matching("ilike")).toEqual([]);
    expect(db.matching('update "suppliers" set')).toEqual([]);
  });
});

describe("the users join row", () => {
  it("is inserted with onConflictDoNothing, so a sanitized email is never un-erased", async () => {
    // Deletion nulls `users.email`. An upsert here would write the incoming
    // address straight back over the erasure — which is why this is
    // deliberately NOT onConflictDoUpdate.
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", [{ steps: {} }]);

    await resolveSupplierSession();

    const insert = db.matching('insert into "users"')[0]!;
    expect(insert.sql).toContain("do nothing");
    expect(insert.sql).not.toContain("do update");
  });

  it("re-syncs a LIVE account's email when it has drifted", async () => {
    db.rows("users", [
      { id: "user-alice", email: "old@example.com", sanitizedAt: null },
    ]);
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", [{ steps: {} }]);

    await resolveSupplierSession();

    const sync = db.matching('update "users" set "email"')[0]!;
    expect(sync.params).toContain("harnstretchtents85@gmail.com");
  });

  it("resolves a SANITIZED account to unauthenticated, and never re-syncs it", async () => {
    // The Better Auth identity is already deleted; this stops a stale
    // cookie-cache session (up to five minutes) sneaking a deleted account back
    // into a portal session — and stops the re-sync above un-erasing the email.
    db.rows("users", [
      { id: "user-gone", email: null, sanitizedAt: new Date() },
    ]);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("unauthenticated");
    expect(db.matching('update "users" set "email"')).toEqual([]);
    expect(db.against("suppliers")).toEqual([]);
  });
});

describe("resolveSupplierSession", () => {
  it("is unauthenticated with nobody signed in, and touches no table", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await resolveSupplierSession()).kind).toBe("unauthenticated");
    expect(db.queries).toEqual([]);
  });

  it("is not_ready with no database configured", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("not_ready");
    expect(db.queries).toEqual([]);
  });

  it("is not_ready when no edition row exists", async () => {
    db.rows("editions", [], []); // no active edition, and none to fall back to

    expect((await resolveSupplierSession()).kind).toBe("not_ready");
  });

  it("falls back to the most recent edition when none is marked active", async () => {
    db.rows(
      "editions",
      [],
      [{ id: "ed-2026", name: "AfrikaBurn 2026", year: 2026 }],
    );
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", [{ steps: {} }]);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.edition.year).toBe(2026);
  });

  it("returns ok with progress derived from the STORED step map", async () => {
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", [
      { steps: { registration_form: "completed", deposit_paid: "completed" } },
    ]);

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.supplier.code).toBe("SUP-2027-0416");
    expect(state.dbUserId).toBe("user-alice");
    expect(state.progress.completed).toBe(2);
    expect(state.progress.total).toBe(7);
    expect(state.progress.isOnboarded).toBe(false);
  });

  it("treats a brand-new onboarding row's empty map as all-pending", async () => {
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", []); // the SELECT after the seed finds nothing

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.steps).toEqual({});
    expect(state.progress.completed).toBe(0);
  });

  it("degrades any thrown failure to not_ready rather than propagating", async () => {
    // Hard engineering rule 4: the portal must stay bootable. A crash here
    // takes out every gated page at once.
    db.failEverything = new Error("connection reset by peer");

    const state = await resolveSupplierSession();

    expect(state.kind).toBe("not_ready");
    if (state.kind !== "not_ready") return;
    expect(state.user.id).toBe("auth-alice");
  });

  it("decodes stored timestamps rather than silently yielding Invalid Date", async () => {
    // Guards the FAKE as much as the code: `mode: "date"` columns decode from
    // Postgres text, and an invalid Date is still a Date, so a broken fixture
    // would otherwise pass every assertion above.
    const at = new Date("2026-07-01T08:30:00.000Z");
    db.rows("users", [
      {
        id: "user-alice",
        email: VERIFIED.primaryEmail,
        sanitizedAt: pgTimestamp(at),
      },
    ]);

    expect((await resolveSupplierSession()).kind).toBe("unauthenticated");
  });
});

describe("requireSupplierSession", () => {
  it("throws one caller-safe error for EVERY non-ok state", async () => {
    // Server actions surface this message verbatim. It must never differ by
    // state — "you have no listing" and "you are signed out" are the same
    // refusal to a caller who should not learn which.
    const cases: [string, () => void][] = [
      [
        "unauthenticated",
        () => vi.mocked(getAuthenticatedUser).mockResolvedValue(null),
      ],
      ["not_ready", () => vi.stubEnv("DATABASE_URL", "")],
      ["unlinked", () => db.rows("suppliers", [], [])],
    ];

    for (const [, arrange] of cases) {
      vi.clearAllMocks();
      db = installFakeDb();
      vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
      vi.mocked(getAuthenticatedUser).mockResolvedValue(VERIFIED);
      db.rows("users", [
        { id: "user-alice", email: VERIFIED.primaryEmail, sanitizedAt: null },
      ]);
      db.rows("editions", [
        { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
      ]);
      arrange();

      await expect(requireSupplierSession()).rejects.toThrow(
        "Sign in as a registered supplier to do that.",
      );
    }
  });

  it("hands back the session without its discriminant when ok", async () => {
    db.rows("suppliers", [listing()]);
    db.rows("supplier_onboarding", [{ steps: {} }]);

    const session = await requireSupplierSession();

    expect(session.supplier.id).toBe("sup-1");
    expect(session.edition.id).toBe("ed-2027");
    expect("kind" in session).toBe(false);
  });
});

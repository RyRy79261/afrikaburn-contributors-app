import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, type FakeDb } from "@/test/fakes/db";
import { refusal, success } from "@/test/fakes/expect";
import type { AuthenticatedUser } from "@/lib/auth";
import type { SupplierSession } from "@/lib/session";

// Self-registration and profile-rename guards (lib/actions/register.ts).
//
// THE DEFECT THESE EXIST TO CLOSE — laundering a suspension. `registerSupplier`
// only ever checked "does THIS ACCOUNT already own a listing", so a supplier
// whose listing was suspended could sign up with a fresh account, re-enter the
// same business name, and land a brand-new row with standing `good` —
// immediately eligible in the org's supplier picker, with the suspension left
// sitting on a row nobody looks at any more. `updateSupplierProfile` is the same
// hole one click later: register as "Karoo Tents (New)", then rename.
//
// The refusal MESSAGES are part of the control, not decoration. An earlier
// version of both sent suppliers to "an administrator" to have the listing
// linked to their account — a control that exists nowhere in the org console.
// The only writer of `suppliers.user_id` on an existing row in the whole
// codebase is the automatic email-overlap claim in lib/session.ts, so that is
// what the unclaimed message must describe, and the claimed one must not
// promise a re-link nobody can perform.
//
// The fake handle compiles real drizzle SQL (see test/fakes/db.ts). What it
// CANNOT prove is Postgres' own behaviour — the `ON CONFLICT` upsert really
// de-duplicating, `lower(btrim(…))` really matching the seed's normalisation.
// Those are the persona suite's job (`pnpm e2e:local`).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSupplierSession: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return {
    ...actual,
    getDb: () => current().handle,
    // The real one opens a pooled WebSocket to Postgres. Here the same handle
    // plays the transaction, so every statement the body issues is recorded in
    // the one sequence — which is what lets a test assert that the step map was
    // read on the SAME handle that wrote it.
    withTransaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(current().handle as never),
  };
});

const { getAuthenticatedUser } = await import("@/lib/auth");
const { requireSupplierSession } = await import("@/lib/session");
const { registerSupplier, updateSupplierProfile } = await import(
  "@/lib/actions/register"
);

const SIGNED_IN: AuthenticatedUser = {
  id: "auth-alice",
  primaryEmail: "alice@example.com",
  displayName: "Alice Hatter",
  emailVerified: true,
};

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(SIGNED_IN);
});

/** A live (non-sanitized) `users` join row for the signed-in account. */
function liveUserRow() {
  return [{ id: "user-alice", sanitizedAt: null }];
}

describe("registerSupplier", () => {
  it("refuses when nobody is signed in, and writes nothing", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await registerSupplier({ name: "Karoo Tents" });

    expect(refusal(result)).toBe("Sign in first.");
    // Not merely "returned an error": the transaction must never open.
    expect(db.queries).toEqual([]);
  });

  it("refuses a whitespace-only business name BEFORE any write", async () => {
    // Zod trims then requires 1 char, so "   " is not a name. The point of
    // asserting on the query log is that a nameless listing must never reach
    // the suppliers table at all — `name` is what every clash check keys on.
    const result = await registerSupplier({ name: "   " });

    expect(refusal(result)).toMatch(/business name is required/i);
    expect(db.queries).toEqual([]);
  });

  it("refuses a deleted-and-sanitized account, whose users row survives", async () => {
    // Deletion nulls the PII on `users` but keeps the row (it is the join key
    // the audit trail hangs off). A stale cookie-cache session — up to five
    // minutes — must not be able to register a business on it.
    db.rows("users", [{ id: "user-gone", sanitizedAt: new Date() }]);

    const result = await registerSupplier({ name: "Karoo Tents" });

    expect(refusal(result)).toBe("Sign in first.");
    expect(db.matching('insert into "suppliers"')).toEqual([]);
  });

  it("refuses when this account already owns a listing", async () => {
    db.rows("users", liveUserRow());
    db.rows("suppliers", [{ id: "sup-existing" }]);

    const result = await registerSupplier({ name: "Karoo Tents" });

    expect(refusal(result)).toBe("You're already registered as a supplier.");
  });

  describe("the name clash that stops a suspension being laundered", () => {
    it("refuses a CLAIMED listing, and never promises a re-link", async () => {
      db.rows("users", liveUserRow());
      // 1st suppliers read: does this account own a row (no).
      // 2nd: the name clash — `claimed` is a raw SQL expression, hence an array.
      db.rows("suppliers", [], [[true]]);

      const message = refusal(await registerSupplier({ name: "Karoo Tents" }));

      expect(message).toMatch(/already registered and linked to an account/i);
      expect(message).toMatch(/sign in with it instead/i);
      expect(message).toMatch(/suppliers@afrikaburn\.com/);
      // The regression: no version of this may send somebody to an
      // administrator to have the listing moved. Nothing in the org console
      // links or unlinks a supplier row.
      expect(message).not.toMatch(/administrator/i);
      expect(db.matching('insert into "suppliers"')).toEqual([]);
    });

    it("refuses an UNCLAIMED listing by describing the automatic claim", async () => {
      db.rows("users", liveUserRow());
      db.rows("suppliers", [], [[false]]);

      const message = refusal(await registerSupplier({ name: "Karoo Tents" }));

      expect(message).toMatch(/AfrikaBurn already has a listing/i);
      // This is the ONLY mechanism that links an account to an existing row —
      // a verified sign-in address matching the listing's contact line.
      expect(message).toMatch(/sign in with the email address/i);
      expect(message).toMatch(/claims it for you automatically/i);
      expect(message).toMatch(/history and standing intact/i);
      expect(message).not.toMatch(/administrator/i);
    });

    it("compares names case- and whitespace-insensitively", async () => {
      db.rows("users", liveUserRow());
      db.rows("suppliers", [], [[false]]);

      await registerSupplier({ name: "  karoo TENTS  " });

      // The seed dedupes on the same normalisation; a clash check that did not
      // would be trivially bypassed by " Karoo Tents".
      const clash = db.matching("lower(btrim(");
      expect(clash).toHaveLength(1);
      expect(clash[0]!.sql).toContain('lower(btrim("suppliers"."name"))');
      // Zod trimmed before the value was ever bound.
      expect(clash[0]!.params).toContain("karoo TENTS");
    });
  });

  it("refuses when no edition row exists at all", async () => {
    db.rows("users", liveUserRow());
    db.rows("suppliers", [], []);
    db.rows("editions", [], []); // no active edition, and no rows to fall back to

    const result = await registerSupplier({ name: "Karoo Tents" });

    expect(refusal(result)).toBe("No active AfrikaBurn edition is set up yet.");
    expect(db.matching('insert into "suppliers"')).toEqual([]);
  });

  it("falls back to the most recent edition when none is marked active", async () => {
    db.rows("users", liveUserRow());
    db.rows(
      "suppliers",
      [], // no listing owned by this account
      [], // no name clash
      [{ id: "sup-new" }], // the insert…returning
      [{ code: null }], // assignSupplierCode: no code yet
      [], // …no codes taken
      [{ code: "SUP-2026-0001" }], // …allocated
    );
    db.rows("editions", [], [{ id: "ed-2026", year: 2026 }]);
    db.rows("supplier_onboarding", []);
    db.rows("audit_events", []);

    success(await registerSupplier({ name: "Karoo Tents" }));

    const editionReads = db.against("editions");
    expect(editionReads).toHaveLength(2);
    expect(editionReads[1]!.sql).toContain('order by "editions"."year" desc');
  });

  it("seeds onboarding with step 1 already done, and audits the registration", async () => {
    db.rows("users", liveUserRow());
    db.rows(
      "suppliers",
      [],
      [],
      [{ id: "sup-new" }],
      [{ code: null }],
      [],
      [{ code: "SUP-2027-0416" }],
    );
    db.rows("editions", [{ id: "ed-2027", year: 2027 }]);
    db.rows("supplier_onboarding", []);
    db.rows("audit_events", []);

    success(
      await registerSupplier({
        name: "Karoo Tents",
        category: "Structures",
        services: "",
      }),
    );

    // Filling this form IS step 1 — the checklist must not ask for it again.
    const seed = db.matching('insert into "supplier_onboarding"');
    expect(seed).toHaveLength(1);
    expect(seed[0]!.params).toContain(
      JSON.stringify({ registration_form: "completed" }),
    );

    // Empty optional strings are stored as NULL, not "" — an empty string reads
    // as "they told us nothing" in every downstream projection.
    const insert = db.matching('insert into "suppliers"')[0]!;
    expect(insert.params).toContain("Karoo Tents");
    expect(insert.params).not.toContain("");

    const audit = db.matching('insert into "audit_events"')[0]!;
    expect(audit.params).toContain("supplier.register");
    expect(audit.params).toContain("user-alice");
    expect(String(audit.params.at(-1))).toContain("portal_self_register");
  });

  it("still registers when the reference code cannot be allocated", async () => {
    // A missing code never blocks onboarding: it is quoted off-platform and is
    // backfillable. Reporting failure here would refuse a valid registration.
    db.rows("users", liveUserRow());
    db.rows("suppliers", [], [], [{ id: "sup-new" }], [{ code: null }]);
    db.rows("editions", [{ id: "ed-2027", year: 2027 }]);
    db.rows("supplier_onboarding", []);
    db.rows("audit_events", []);
    // Every code-allocation attempt fails from here on (the suppliers queue is
    // exhausted, so the UPDATE…RETURNING yields no row, five times over).

    success(await registerSupplier({ name: "Karoo Tents" }));

    expect(db.matching('insert into "audit_events"')).toHaveLength(1);
  });
});

describe("updateSupplierProfile", () => {
  const SESSION = {
    user: SIGNED_IN,
    dbUserId: "user-alice",
    supplier: {
      id: "sup-alice",
      name: "Karoo Tents (New)",
      code: null,
      services: null,
      contact: null,
      website: null,
      category: null,
      returning: null,
      standing: "good",
    },
    edition: { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
    steps: {},
    progress: { completed: 0, total: 7, percent: 0 },
  } as unknown as SupplierSession;

  function signedIn(overrides: Partial<SupplierSession> = {}) {
    vi.mocked(requireSupplierSession).mockResolvedValue({
      ...SESSION,
      ...overrides,
    });
  }

  it("refuses a RENAME onto another listing's name", async () => {
    // The bypass this closes: register under a free name, then rename onto the
    // suspended listing's name. Without this the register-time guard is one
    // click away from worthless.
    signedIn();
    db.rows("suppliers", [[true]]);

    const message = refusal(
      await updateSupplierProfile({ name: "Karoo Tents" }),
    );

    expect(message).toMatch(/Another supplier is already listed under that/i);
    expect(message).toMatch(/suppliers@afrikaburn\.com/);
    expect(db.matching('update "suppliers" set')).toEqual([]);
  });

  it("excludes the caller's own row, so an unchanged name still saves", async () => {
    signedIn();
    db.rows("suppliers", []); // no OTHER row holds the name
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("supplier_documents", []);
    db.rows("audit_events", []);

    success(await updateSupplierProfile({ name: "Karoo Tents (New)" }));

    const clash = db.matching("lower(btrim(")[0]!;
    expect(clash.sql).toContain('"suppliers"."id" <> $');
    expect(clash.params).toContain("sup-alice");
    expect(db.matching('update "suppliers" set')).toHaveLength(1);
  });

  it("marks registration_form completed when no document is bound to it", async () => {
    signedIn();
    db.rows("suppliers", []);
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("supplier_documents", []); // nothing bound
    db.rows("audit_events", []);

    success(await updateSupplierProfile({ name: "Karoo Tents (New)" }));

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      registration_form: "completed",
    });
  });

  it("leaves the step alone when a required document is bound, but still saves the profile", async () => {
    // A document-bound step has exactly ONE completion path — the
    // acknowledgement. Completing it here too left the step flapping: marked
    // done by a profile save, reverted by the supplier's next tick on any
    // document, with no explanation either way.
    signedIn();
    db.rows("suppliers", []);
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("supplier_documents", [
      {
        id: "doc-1",
        title: "Supplier agreement",
        sourceType: "link",
        url: "https://example.com/a.pdf",
        requiredAck: true,
        stepKey: "registration_form",
        sort: 0,
      },
    ]);
    db.rows("audit_events", []);

    success(await updateSupplierProfile({ name: "Karoo Tents (New)" }));

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({});
    // The profile itself still saved — only the step was left alone.
    expect(db.matching('update "suppliers" set')).toHaveLength(1);
  });

  it("builds the next step map from the transaction-locked copy, never from session.steps", async () => {
    // THE REGRESSION. `steps` is one jsonb column holding all seven steps and
    // every writer persists the whole map. Seeding it from `session.steps` —
    // read before the transaction, on another connection — republished a stale
    // copy of every OTHER step. AfrikaBurn marks "Deposit received"; the
    // supplier saves their profile a moment later; the deposit silently drops
    // back to "Awaiting AfrikaBurn", with nothing in the audit trail naming it.
    signedIn({
      steps: { deposit_paid: "pending" },
    } as unknown as Partial<SupplierSession>);
    db.rows("suppliers", []);
    // what the org just committed, read on the transaction
    db.rows("supplier_onboarding", [{ steps: { deposit_paid: "completed" } }]);
    db.rows("supplier_documents", []);
    db.rows("audit_events", []);

    success(await updateSupplierProfile({ name: "Karoo Tents (New)" }));

    const read = db.matching('select "steps" from "supplier_onboarding"')[0]!;
    expect(read.sql).toContain("for update");

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      deposit_paid: "completed",
      registration_form: "completed",
    });
  });

  it("refuses without an ok supplier session", async () => {
    vi.mocked(requireSupplierSession).mockRejectedValue(
      new Error("Sign in as a registered supplier to do that."),
    );

    const result = await updateSupplierProfile({ name: "Karoo Tents" });

    expect(refusal(result)).toBe("Sign in as a registered supplier to do that.");
    expect(db.queries).toEqual([]);
  });
});

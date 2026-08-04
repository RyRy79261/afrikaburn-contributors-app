import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dbMock } from "@/test/db-mock";
import { cookieJar, resetNextMocks } from "@/test/next-mocks";

vi.mock("@/lib/db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock(
  "next/headers",
  async () => (await import("@/test/next-mocks")).nextHeadersMock(),
);

/** The Better Auth reads live in @quagga/auth and need a live identity store;
 * only the COUNT of sign-in methods matters to the guard context. */
const linkedAccounts = vi.hoisted(() => ({
  value: [{ providerId: "credential" }] as { providerId: string }[],
}));
vi.mock("@quagga/auth/account", () => ({
  listAccountSessions: async () => [],
  listAccountPasskeys: async () => [],
  listLinkedAccounts: async () => linkedAccounts.value,
  parseSetCookies: () => [
    { name: "better-auth.session_token", value: "fresh", options: {} },
  ],
  deviceLabel: () => "device",
  describeSignInMethods: () => "",
  getTwoFactorEnabled: async () => false,
}));

const {
  buildDeletionGuardContext,
  buildDeletionView,
  getDeletionRequest,
  getEmailChangeRequest,
  buildEmailChangeView,
  applyAuthCookies,
  accountCapabilities,
} = await import("../account");

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "0f9a0000-0000-0000-0000-00000000000a";
const CAMP = "11111111-1111-1111-1111-111111111111";
const SUPPLIER = "5b5b5b5b-0000-0000-0000-000000000001";

/**
 * The six reads `buildDeletionGuardContext` makes, in order. Passing `null` for
 * `orgGroup` or `supplier` skips the follow-up query the source skips too.
 */
function queueGuardContext(input: {
  leadRows?: unknown[];
  orgGroup?: { id: string } | null;
  mine?: { role: string } | null;
  godCount?: number;
  supplier?: { id: string; name: string } | null;
  onboarding?: { steps: Record<string, string> } | null;
}) {
  dbMock.queue(input.leadRows ?? []);
  dbMock.queue(input.orgGroup ? [input.orgGroup] : []);
  if (input.orgGroup) {
    dbMock.queue(input.mine ? [input.mine] : []);
    dbMock.queue([{ count: input.godCount ?? 0 }]);
  }
  dbMock.queue(input.supplier ? [input.supplier] : []);
  if (input.supplier) dbMock.queue(input.onboarding ? [input.onboarding] : []);
}

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  linkedAccounts.value = [{ providerId: "credential" }];
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildDeletionGuardContext — counting things accurately", () => {
  it("returns the empty context without querying when the database is unconfigured", async () => {
    vi.stubEnv("DATABASE_URL", "");

    expect(await buildDeletionGuardContext(USER)).toEqual({
      ledProjects: [],
      isOrgGod: false,
      orgGodCount: 0,
      signInMethodCount: 0,
    });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("reports leadCount 1 for a sole lead and 2 when somebody else leads too", async () => {
    // The count is what the sole-lead block is decided on. It miscounted once:
    // sanitization PRESERVES memberships, so a departed lead's row was still
    // `role = 'lead'` and still counted — the block never fired and the last
    // LIVE lead walked out of a camp nobody could administer.
    queueGuardContext({
      leadRows: [{ groupId: CAMP, name: "Mad Hatters", leadCount: 1 }],
    });
    expect((await buildDeletionGuardContext(USER)).ledProjects).toEqual([
      { groupId: CAMP, name: "Mad Hatters", leadCount: 1 },
    ]);

    dbMock.reset();
    queueGuardContext({
      leadRows: [{ groupId: CAMP, name: "Mad Hatters", leadCount: "2" }],
    });
    // Postgres may hand a bigint back as a string; the guard compares numbers.
    expect(
      (await buildDeletionGuardContext(USER)).ledProjects[0]!.leadCount,
    ).toBe(2);
  });

  it("is isOrgGod only for the god role specifically", async () => {
    queueGuardContext({
      orgGroup: { id: ORG_ID },
      mine: { role: "god" },
      godCount: 2,
    });
    const asGod = await buildDeletionGuardContext(USER);
    expect(asGod.isOrgGod).toBe(true);
    expect(asGod.orgGodCount).toBe(2);

    dbMock.reset();
    queueGuardContext({
      orgGroup: { id: ORG_ID },
      mine: { role: "org_staff" },
      godCount: 1,
    });
    expect((await buildDeletionGuardContext(USER)).isOrgGod).toBe(false);
  });

  it("counts no gods and holds no org role when the org group is not seeded", async () => {
    queueGuardContext({ orgGroup: null });

    const ctx = await buildDeletionGuardContext(USER);
    expect(ctx.orgGodCount).toBe(0);
    expect(ctx.orgRole).toBeNull();
  });

  it("reports org_staff and engineer as orgRole, and a plain member as null", async () => {
    // Not a block — nobody is stranded by it — but the account IS told, because
    // an org access grant surviving on a tombstone is what this closes.
    for (const role of ["org_staff", "engineer"]) {
      dbMock.reset();
      queueGuardContext({ orgGroup: { id: ORG_ID }, mine: { role } });
      expect((await buildDeletionGuardContext(USER)).orgRole).toBe(role);
    }

    dbMock.reset();
    queueGuardContext({ orgGroup: { id: ORG_ID }, mine: { role: "member" } });
    expect((await buildDeletionGuardContext(USER)).orgRole).toBeNull();
  });

  it("is in flight only for a STARTED but unfinished active-edition checklist", async () => {
    queueGuardContext({
      supplier: { id: SUPPLIER, name: "LosKop Catering" },
      onboarding: {
        steps: { registration_form: "completed", deposit_paid: "pending" },
      },
    });

    const ctx = await buildDeletionGuardContext(USER);
    expect(ctx.claimedSupplierName).toBe("LosKop Catering");
    expect(ctx.hasInFlightSupplierOnboarding).toBe(true);
  });

  it("is NOT in flight for a supplier who has touched nothing", async () => {
    // Warning someone mid-deletion about a checklist they never began is noise,
    // and this warning has to mean something to survive.
    queueGuardContext({
      supplier: { id: SUPPLIER, name: "LosKop Catering" },
      onboarding: { steps: {} },
    });

    expect(
      (await buildDeletionGuardContext(USER)).hasInFlightSupplierOnboarding,
    ).toBe(false);
  });

  it("names a claimed supplier with no onboarding row for this edition, without warning", async () => {
    queueGuardContext({
      supplier: { id: SUPPLIER, name: "LosKop Catering" },
      onboarding: null,
    });

    const ctx = await buildDeletionGuardContext(USER);
    expect(ctx.claimedSupplierName).toBe("LosKop Catering");
    expect(ctx.hasInFlightSupplierOnboarding).toBe(false);
  });

  it("counts the sign-in methods the identity provider reports", async () => {
    linkedAccounts.value = [{ providerId: "credential" }, { providerId: "google" }];
    queueGuardContext({});

    expect((await buildDeletionGuardContext(USER)).signInMethodCount).toBe(2);
  });
});

describe("getDeletionRequest / getEmailChangeRequest", () => {
  it("both are null when the database is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await getDeletionRequest(USER)).toBeNull();
    expect(await getEmailChangeRequest(USER)).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });

  it("both swallow a thrown query so the account pages still render", async () => {
    dbMock.queue(new Error("connection terminated unexpectedly"));
    expect(await getDeletionRequest(USER)).toBeNull();

    dbMock.reset();
    dbMock.queue(new Error("connection terminated unexpectedly"));
    expect(await getEmailChangeRequest(USER)).toBeNull();
  });

  it("getDeletionRequest returns the pending row", async () => {
    const requestedAt = new Date("2026-08-01T00:00:00Z");
    dbMock.queue([
      {
        id: "req-1",
        status: "pending",
        requestedAt,
        graceEndsAt: new Date("2026-08-15T00:00:00Z"),
        cancelledAt: null,
        completedAt: null,
      },
    ]);

    expect((await getDeletionRequest(USER))?.id).toBe("req-1");
  });
});

describe("buildDeletionView", () => {
  it("composes the phase, the days remaining and the eligibility verdict", async () => {
    const now = new Date("2026-08-05T00:00:00Z");
    dbMock.queue([
      {
        id: "req-1",
        status: "pending",
        requestedAt: new Date("2026-08-01T00:00:00Z"),
        graceEndsAt: new Date("2026-08-15T00:00:00Z"),
        cancelledAt: null,
        completedAt: null,
      },
    ]);
    queueGuardContext({});

    const view = await buildDeletionView(USER, now);
    expect(view.phase).toBe("grace");
    expect(view.daysRemaining).toBe(10);
    expect(view.eligibility.ok).toBe(true);
  });

  it("REFUSES when a guard blocks — a sole lead must transfer leadership first", async () => {
    dbMock.queue([]);
    queueGuardContext({
      leadRows: [{ groupId: CAMP, name: "Mad Hatters", leadCount: 1 }],
    });

    const view = await buildDeletionView(USER, new Date("2026-08-05"));
    expect(view.phase).toBe("none");
    expect(view.eligibility.ok).toBe(false);
    expect(view.eligibility.blocks.map((b) => b.code)).toContain("sole_camp_lead");
  });
});

describe("buildEmailChangeView", () => {
  it("reports providerApplied only when the identity update actually committed", async () => {
    dbMock.queue([
      {
        id: "ec-1",
        newEmail: "new@example.com",
        status: "confirmed",
        expiresAt: new Date("2026-08-10"),
        confirmedAt: new Date("2026-08-04"),
        revocableUntil: new Date("2026-08-06"),
        revokedAt: null,
        providerCommittedAt: null,
      },
    ]);

    const view = await buildEmailChangeView(USER, new Date("2026-08-05"));
    expect(view.newEmail).toBe("new@example.com");
    // Our side moved and the provider's did not — the tombstone must not claim
    // a change that never landed.
    expect(view.providerApplied).toBe(false);
  });

  it("is the empty view when there is no request", async () => {
    dbMock.queue([]);
    const view = await buildEmailChangeView(USER, new Date("2026-08-05"));
    expect(view.newEmail).toBeNull();
    expect(view.providerApplied).toBe(false);
  });
});

describe("applyAuthCookies", () => {
  it("hands the provider's fresh session cookie back to the browser", async () => {
    await applyAuthCookies(new Headers());
    expect(cookieJar.entries().map((c) => c.name)).toEqual([
      "better-auth.session_token",
    ]);
  });

  it("SWALLOWS a read-only cookie store rather than failing the action", async () => {
    // The password has already changed by the time this runs. A throw here
    // would turn a successful change into a reported failure.
    cookieJar.readOnly = true;
    await expect(applyAuthCookies(new Headers())).resolves.toBeUndefined();
  });
});

describe("accountCapabilities", () => {
  it("lists every capability so the security page can render an honest state", () => {
    const caps = accountCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) expect(typeof cap.support).toBe("string");
  });
});

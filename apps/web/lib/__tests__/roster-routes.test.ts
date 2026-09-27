import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind, MembershipRole } from "@quagga/types";
import { dbMock } from "@/test/db-mock";
import { resetNextMocks, revalidated } from "@/test/next-mocks";

// The two request boundaries of epic #55 — the logistics server action and the
// roster CSV route — run over the REAL roster store and a fake database, so
// the refusals asserted here are the ones @quagga/core actually makes.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const stubs = vi.hoisted(() => ({
  user: { id: "", email: "x@example.com" } as {
    id: string;
    email: string;
  } | null,
  gated: null as string | null,
  dbConfigured: true,
  edition: {
    id: "eeeeeeee-0000-4000-8000-000000000000",
    name: "AfrikaBurn 2027",
    year: 2027,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
    isActive: true,
  } as unknown,
  perms: new Map<string, unknown>(),
}));

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => {
    if (!stubs.user) throw new Error("NEXT_REDIRECT;replace;/auth/sign-in");
    return stubs.user;
  },
  getCurrentCampUser: async () => stubs.user,
  enforceGate: async () => {
    if (stubs.gated) throw new Error(`NEXT_REDIRECT;replace;${stubs.gated}`);
  },
}));
vi.mock("@/lib/config", () => ({
  isDatabaseConfigured: () => stubs.dbConfigured,
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => stubs.edition,
}));
vi.mock("@/lib/roles-store", () => ({
  getMemberPermissions: async (groupId: string, userId: string) =>
    stubs.perms.get(`${groupId}:${userId}`) ?? null,
  listRoles: async () => [],
  getRoleAssignments: async () => new Map(),
  getOfficerStatus: async () => ({
    isRegisteredOrInFlight: false,
    outstanding: {
      outstanding: [],
      requiredCount: 0,
      assignedCount: 0,
      applies: false,
    },
    officers: [],
  }),
}));

const { saveMyLogisticsAction } =
  await import("@/app/(app)/camps/[slug]/logistics-actions");
const { GET } = await import("@/app/(app)/camps/[slug]/roster/export/route");

const THEME_CAMP = GroupKind.enum.theme_camp;
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead of camp A
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member of camp A
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // lead of camp B
const CAMP_A = {
  id: "11111111-0000-4000-8000-00000000000a",
  name: "Mad Hatters",
  slug: "mad-hatters",
  kind: THEME_CAMP,
};
const CAMP_B = "11111111-0000-4000-8000-00000000000b";

const PLAN = {
  joiningBuild: true,
  joiningStrike: false,
  arrivalDate: "2027-04-22",
  departureDate: "2027-05-03",
};

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
  stubs.user = { id: REN, email: "ren@example.com" };
  stubs.gated = null;
  stubs.dbConfigured = true;
  stubs.perms = new Map<string, unknown>([
    [`${CAMP_A.id}:${ALICE}`, { structuralRole: LEAD, rolePermissions: [{}] }],
    [`${CAMP_A.id}:${REN}`, { structuralRole: MEMBER, rolePermissions: [{}] }],
    [`${CAMP_B}:${JABU}`, { structuralRole: LEAD, rolePermissions: [{}] }],
  ]);
});

describe("saveMyLogisticsAction", () => {
  it("saves the caller's own plans and revalidates the camp pages", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }]);
    const result = await saveMyLogisticsAction({
      slug: CAMP_A.slug,
      logistics: PLAN,
    });
    expect(result).toEqual({ ok: true, logistics: PLAN });
    expect(
      dbMock.writesTo(schema.membershipLogistics)[0]!.arg("values"),
    ).toMatchObject({ membershipId: "m-ren" });
    expect(revalidated.map((r) => r.path)).toEqual([
      "/camps/mad-hatters",
      "/camps/mad-hatters/roster",
    ]);
  });

  it("refuses an envelope that names a target member, before any read", async () => {
    const result = await saveMyLogisticsAction({
      slug: CAMP_A.slug,
      logistics: PLAN,
      userId: ALICE,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses logistics that name someone else's membership", async () => {
    // A lead trying to set a member's plans: the body can name the member's
    // membership, but whose row is written comes from the session — and the
    // strict shape refuses the attempt outright.
    stubs.user = { id: ALICE, email: "alice@example.com" };
    dbMock.queue([{ id: "m-alice", userId: ALICE, groupKind: THEME_CAMP }]);
    const result = await saveMyLogisticsAction({
      slug: CAMP_A.slug,
      logistics: { ...PLAN, membershipId: "m-ren" },
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("refuses a caller who is not a member of the camp", async () => {
    stubs.user = { id: JABU, email: "jabu@example.com" };
    dbMock.queue([]);
    const result = await saveMyLogisticsAction({
      slug: CAMP_A.slug,
      logistics: PLAN,
    });
    expect(result).toEqual({
      ok: false,
      error: "You're not a member of this camp.",
    });
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses when there is no edition to plan for", async () => {
    stubs.edition = null;
    const result = await saveMyLogisticsAction({
      slug: CAMP_A.slug,
      logistics: PLAN,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
    stubs.edition = {
      id: "eeeeeeee-0000-4000-8000-000000000000",
      name: "AfrikaBurn 2027",
      year: 2027,
      startDate: "2027-04-26",
      endDate: "2027-05-02",
      isActive: true,
    };
  });
});

describe("GET /camps/[slug]/roster/export", () => {
  const request = (query = "") =>
    GET(
      new Request(
        `https://app.example/camps/mad-hatters/roster/export${query}`,
      ),
      { params: Promise.resolve({ slug: CAMP_A.slug }) },
    );

  const MEMBER_ROWS = [
    {
      membershipId: "m-alice",
      userId: ALICE,
      role: LEAD,
      username: "Alice Hatter",
      sanitizedAt: null,
      bioId: "b1",
      bioCompletedAt: new Date(),
      bioFirstTime: false,
      logisticsId: "l1",
      joiningBuild: true,
      joiningStrike: true,
      arrivalDate: "2027-04-20",
      departureDate: "2027-05-03",
    },
    {
      membershipId: "m-ren",
      userId: REN,
      role: MEMBER,
      username: '=HYPERLINK("http://evil")',
      sanitizedAt: null,
      bioId: null,
      bioCompletedAt: null,
      bioFirstTime: null,
      logisticsId: null,
      joiningBuild: null,
      joiningStrike: null,
      arrivalDate: null,
      departureDate: null,
    },
  ];

  it("is a 404 when signed out", async () => {
    stubs.user = null;
    const res = await request();
    expect(res.status).toBe(404);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("is a 404 without a database", async () => {
    stubs.dbConfigured = false;
    expect((await request()).status).toBe(404);
  });

  it("is a 404 for a member without view_member_details", async () => {
    dbMock.queue([CAMP_A]);
    const res = await request();
    expect(res.status).toBe(404);
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("is a 404 for a lead of another camp — the same answer as no camp", async () => {
    stubs.user = { id: JABU, email: "jabu@example.com" };
    dbMock.queue([CAMP_A]);
    const refused = await request();
    dbMock.queue([]);
    const missing = await request();
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await refused.text()).toBe(await missing.text());
  });

  it("is a 404 for a malformed slug", async () => {
    const res = await GET(new Request("https://app.example/x"), {
      params: Promise.resolve({ slug: "" }),
    });
    expect(res.status).toBe(404);
  });

  it("sends a gated lead to their blocking action first", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    stubs.gated = "/onboarding";
    await expect(request()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("downloads the CSV for a lead — no phone, no medical, formulas neutralised", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    dbMock.queue([CAMP_A], MEMBER_ROWS);
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="mad-hatters-2027-roster-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.text();
    expect(body).toContain(
      "Name,Burner name,Roles,Arrival,Departure,Joining build,Joining strike",
    );
    expect(body).not.toMatch(/phone|medical/i);
    expect(body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(body).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });

  it("carries the page's filter into the file", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    dbMock.queue([CAMP_A], MEMBER_ROWS);
    const body = await (await request("?bio=incomplete&junk=1")).text();
    expect(body).not.toContain("Alice Hatter");
    expect(body.trim().split("\r\n")).toHaveLength(2);
  });
});

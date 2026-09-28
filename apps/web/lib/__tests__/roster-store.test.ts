import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import {
  GroupKind,
  MembershipRole,
  ProjectRoleKind,
  RoleAssignmentConsent,
  type ProjectPermissions,
} from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";

// The roster store (epic #55): the boundary between the database and the
// @quagga/core roster predicates. What these tests pin is the DECISION — who
// is refused, before which read, and what a refusal leaves unread — plus the
// shape of the one write. They cannot prove the SQL (see test/db-mock.ts).

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  /** `${groupId}:${userId}` → the permission membership getMemberPermissions
   * answers; absent ⇒ not a member (null). */
  perms: new Map<string, unknown>(),
  roles: [] as unknown[],
  assignments: new Map<string, unknown[]>(),
  officers: {
    isRegisteredOrInFlight: false,
    outstanding: {
      outstanding: [],
      requiredCount: 0,
      assignedCount: 0,
      applies: false,
    },
    officers: [],
  } as unknown,
  permCalls: [] as string[],
  /** The `status` each getRoleAssignments call asked for. */
  assignmentStatuses: [] as (string | undefined)[],
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async (groupId: string, userId: string) => {
    stubs.permCalls.push(`${groupId}:${userId}`);
    return stubs.perms.get(`${groupId}:${userId}`) ?? null;
  },
  listRoles: async () => stubs.roles,
  getRoleAssignments: async (_groupId: string, status?: string) => {
    stubs.assignmentStatuses.push(status);
    return stubs.assignments;
  },
  getOfficerStatus: async () => stubs.officers,
}));

const {
  exportCampRosterCsv,
  getOwnLogistics,
  loadCampRoster,
  saveOwnLogistics,
} = await import("../roster-store");

// Values from the real vocabularies (AGENTS.md "Verification": a fixture
// outside the enum is inert). Ids are fictional.
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const ACCEPTED = RoleAssignmentConsent.enum.accepted;
const PENDING = RoleAssignmentConsent.enum.pending;

const EDITION = {
  id: "eeeeeeee-0000-4000-8000-000000000000",
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead of camp A
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member of camp A
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // lead of camp B only
const CAMP_A = {
  id: "11111111-0000-4000-8000-00000000000a",
  name: "Mad Hatters",
  slug: "mad-hatters",
  kind: THEME_CAMP,
};
const CAMP_B = "11111111-0000-4000-8000-00000000000b";
const BASELINE = "b0000000-0000-4000-8000-000000000000";
const KITCHEN = "c0000000-0000-4000-8000-000000000001";
const OFFICER = "c0000000-0000-4000-8000-000000000002";

function role(
  id: string,
  kind: ProjectRoleKind,
  name: string,
  permissions: ProjectPermissions = {},
) {
  return {
    id,
    name,
    kind,
    isDefault: false,
    sort: 0,
    color: "teal",
    emoji: null,
    permissions,
    officerKey: null,
  };
}

const leadPerms = { structuralRole: LEAD, rolePermissions: [{}] };
const memberPerms = { structuralRole: MEMBER, rolePermissions: [{}] };
const grantedPerms = {
  structuralRole: MEMBER,
  rolePermissions: [{}, { view_member_details: true }],
};

/** A roster row as the member query returns it. */
function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "m-ren",
    userId: REN,
    role: MEMBER,
    username: "Ren Notfound",
    sanitizedAt: null,
    bioId: "bio-ren",
    bioCompletedAt: null,
    bioFirstTime: true,
    logisticsId: null,
    joiningBuild: null,
    joiningStrike: null,
    arrivalDate: null,
    departureDate: null,
    ...overrides,
  };
}

const ROWS = [
  memberRow({
    membershipId: "m-alice",
    userId: ALICE,
    role: LEAD,
    username: "Alice Hatter",
    bioId: "bio-alice",
    bioCompletedAt: new Date("2027-01-10T00:00:00Z"),
    bioFirstTime: false,
    logisticsId: "l-alice",
    joiningBuild: true,
    joiningStrike: false,
    arrivalDate: "2027-04-20",
    departureDate: "2027-05-03",
  }),
  memberRow(),
  memberRow({
    membershipId: "m-gone",
    userId: "aaaaaaaa-0000-4000-8000-000000000009",
    username: "old-name",
    sanitizedAt: new Date("2026-09-01T00:00:00Z"),
    bioId: null,
    bioCompletedAt: null,
    bioFirstTime: null,
  }),
];

/** Column names a select chain asked for. */
function selectedKeys(index: number): string[] {
  return Object.keys(
    (dbMock.queries[index]!.arg("select") as Record<string, unknown>) ?? {},
  );
}

const SENSITIVE = [
  "phone",
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
  "medicalNotes",
  "saIdEncrypted",
  "passportEncrypted",
  "email",
  "legalName",
];

beforeEach(() => {
  dbMock.reset();
  stubs.perms = new Map<string, unknown>([
    [`${CAMP_A.id}:${ALICE}`, leadPerms],
    [`${CAMP_A.id}:${REN}`, memberPerms],
    [`${CAMP_B}:${JABU}`, leadPerms],
  ]);
  stubs.roles = [
    role(BASELINE, ProjectRoleKind.enum.baseline, "Everyone"),
    role(KITCHEN, ProjectRoleKind.enum.custom, "Kitchen"),
    role(OFFICER, ProjectRoleKind.enum.officer, "LNT officer"),
  ];
  stubs.assignments = new Map([
    [
      "m-ren",
      [
        { projectRoleId: KITCHEN, consent: ACCEPTED, orgVisible: false },
        // A pending officer ask is not a held role.
        { projectRoleId: OFFICER, consent: PENDING, orgVisible: false },
      ],
    ],
  ]);
  stubs.permCalls = [];
  stubs.assignmentStatuses = [];
});

/** The chains that read `memberships` (not the logistics upsert, not groups). */
function membershipReads() {
  return dbMock
    .queriesTouching(schema.memberships)
    .filter((q) => q.kind === "select");
}

describe("loadCampRoster — refusals", () => {
  const load = (viewerUserId: string, slug = CAMP_A.slug) =>
    loadCampRoster({
      slug,
      viewerUserId,
      editionId: EDITION.id,
      searchParams: {},
    });

  it("refuses a slug that does not exist, without asking about permissions", async () => {
    dbMock.queue([]);
    expect(await load(ALICE, "no-such-camp")).toBeNull();
    expect(stubs.permCalls).toHaveLength(0);
  });

  it("refuses the org group", async () => {
    dbMock.queue([{ ...CAMP_A, kind: ORG }]);
    expect(await load(ALICE)).toBeNull();
    expect(dbMock.queriesTouching(schema.memberships)).toHaveLength(0);
  });

  it("refuses a non-member BEFORE any member, bio or logistics row is read", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load("aaaaaaaa-0000-4000-8000-0000000000ff")).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses a member without view_member_details the same way", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load(REN)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("refuses a lead of ANOTHER camp — their permission is looked up for THIS camp", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load(JABU)).toBeNull();
    expect(stubs.permCalls).toEqual([`${CAMP_A.id}:${JABU}`]);
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });
});

describe("loadCampRoster — an authorised viewer", () => {
  it("returns rows, stats and role options for a lead", async () => {
    dbMock.queue([CAMP_A], ROWS);
    const page = await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      editionId: EDITION.id,
      searchParams: {},
    });
    expect(page).not.toBeNull();
    expect(page!.camp).toEqual(CAMP_A);
    expect(page!.roster.total).toBe(3);
    expect(page!.roster.rows.map((r) => r.displayName)).toEqual([
      "Alice Hatter",
      "Departed Burner",
      "Ren Notfound",
    ]);
    const ren = page!.roster.rows.find((r) => r.userId === REN)!;
    // Accepted custom role only — not baseline, not the pending officer ask.
    expect(ren.projectRoles).toEqual([{ id: KITCHEN, name: "Kitchen" }]);
    expect(ren.bioStatus).toBe("incomplete");
    expect(ren.logistics).toBeNull();
    const alice = page!.roster.rows.find((r) => r.userId === ALICE)!;
    expect(alice.logistics).toEqual({
      joiningBuild: true,
      joiningStrike: false,
      arrivalDate: "2027-04-20",
      departureDate: "2027-05-03",
    });
    // A departed account shows the stub and no burner name.
    const gone = page!.roster.rows.find((r) => r.membershipId === "m-gone")!;
    expect(gone.username).toBeNull();
    expect(gone.bioStatus).toBe("none");

    expect(page!.stats).toMatchObject({
      total: 3,
      newcomers: 1,
      returning: 1,
      unknown: 1,
      biosComplete: 1,
    });
    // Baseline is not a filter option; officer and custom roles are.
    expect(page!.roleOptions.map((r) => r.id)).toEqual([KITCHEN, OFFICER]);
  });

  it("never selects a sensitive bio column", async () => {
    dbMock.queue([CAMP_A], ROWS);
    await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      editionId: EDITION.id,
      searchParams: {},
    });
    const memberQuery = dbMock.queries.findIndex((q) =>
      q.calls.some((c) => c.args.includes(schema.burnerBios)),
    );
    expect(memberQuery).toBeGreaterThanOrEqual(0);
    const keys = selectedKeys(memberQuery);
    expect(keys).toContain("bioCompletedAt");
    for (const column of SENSITIVE) expect(keys).not.toContain(column);
  });

  it("lets a member through whose role grants view_member_details", async () => {
    stubs.perms.set(`${CAMP_A.id}:${REN}`, grantedPerms);
    dbMock.queue([CAMP_A], ROWS);
    const page = await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: REN,
      editionId: EDITION.id,
      searchParams: {},
    });
    expect(page?.roster.total).toBe(3);
  });

  it("applies the URL filter server-side, keeping stats over the whole camp", async () => {
    dbMock.queue([CAMP_A], ROWS);
    const page = await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      editionId: EDITION.id,
      searchParams: { bio: "complete" },
    });
    expect(page!.filter.bio).toBe("complete");
    expect(page!.roster.rows.map((r) => r.userId)).toEqual([ALICE]);
    expect(page!.stats.total).toBe(3);
  });

  it("filters by a project role of this camp", async () => {
    dbMock.queue([CAMP_A], ROWS);
    const page = await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      editionId: EDITION.id,
      searchParams: { role: `role:${KITCHEN}` },
    });
    expect(page!.roster.rows.map((r) => r.userId)).toEqual([REN]);
  });

  it("reports officer slots from the officer status", async () => {
    stubs.officers = {
      isRegisteredOrInFlight: true,
      outstanding: {
        outstanding: ["sound_officer"],
        requiredCount: 2,
        assignedCount: 1,
        applies: true,
      },
      officers: [],
    };
    dbMock.queue([CAMP_A], ROWS);
    const page = await loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      editionId: EDITION.id,
      searchParams: {},
    });
    expect(page!.stats.officers).toEqual({
      applies: true,
      filled: 1,
      required: 2,
    });
  });
});

// --- Former members (CDB-036) -----------------------------------------------
//
// Archiving revokes camp access. On the roster that means two things the mock
// CAN see: which rows each membership read asks for (`archived_at is null` for
// the camp, `is not null` for the former list), and what the viewer is offered
// on each row.

describe("loadCampRoster — former members", () => {
  const load = (
    viewerUserId: string,
    searchParams: Record<string, string> = {},
  ) =>
    loadCampRoster({
      slug: CAMP_A.slug,
      viewerUserId,
      editionId: EDITION.id,
      searchParams,
    });

  it("reads only CURRENT members for the roster, and counts former ones separately", async () => {
    dbMock.queue([CAMP_A], ROWS, [{ count: 2 }]);
    const page = await load(ALICE);
    const reads = membershipReads();
    // The roster rows, then the former-member count.
    expect(reads).toHaveLength(2);
    expect(nullChecksOn(reads[0]!, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(nullChecksOn(reads[1]!, schema.memberships.archivedAt)).toEqual([
      "is not null",
    ]);
    expect(stubs.assignmentStatuses).toEqual(["current"]);
    expect(page!.stats.former).toBe(2);
    expect(page!.stats.total).toBe(3);
  });

  it("status=former lists the FORMER rows, with their roles held, and keeps stats on the camp", async () => {
    const formerRow = memberRow({
      membershipId: "m-jabu",
      userId: JABU,
      username: "Jabu",
      bioId: null,
      bioCompletedAt: null,
      bioFirstTime: null,
    });
    stubs.assignments = new Map([
      [
        "m-jabu",
        [{ projectRoleId: KITCHEN, consent: ACCEPTED, orgVisible: false }],
      ],
    ]);
    dbMock.queue([CAMP_A], ROWS, [formerRow], [{ count: 1 }]);
    const page = await load(ALICE, { status: "former" });

    expect(page!.filter.status).toBe("former");
    expect(page!.roster.rows.map((r) => r.userId)).toEqual([JABU]);
    // History stays: the role they held is still on their row.
    expect(page!.roster.rows[0]!.projectRoles).toEqual([
      { id: KITCHEN, name: "Kitchen" },
    ]);
    // The card still describes the CURRENT camp.
    expect(page!.stats.total).toBe(3);
    expect(page!.stats.former).toBe(1);

    const reads = membershipReads();
    expect(nullChecksOn(reads[0]!, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(nullChecksOn(reads[1]!, schema.memberships.archivedAt)).toEqual([
      "is not null",
    ]);
    expect(stubs.assignmentStatuses).toEqual(["current", "former"]);
    // The lead may restore them.
    expect(page!.actions).toEqual({ "m-jabu": "restore" });
  });

  it("loads NO bio for a former member — not completion, not the first-timer flag", async () => {
    // A bio row IS returned here on purpose: only the store's own refusal can
    // keep it off the former list (the mock does not evaluate the join).
    const formerRow = memberRow({
      membershipId: "m-jabu",
      userId: JABU,
      username: "Jabu",
      bioId: "bio-jabu",
      bioCompletedAt: new Date("2027-03-01"),
      bioFirstTime: true,
    });
    dbMock.queue([CAMP_A], ROWS, [formerRow], [{ count: 1 }]);
    const page = await load(ALICE, { status: "former" });
    expect(page!.roster.rows).toHaveLength(1);
    expect(page!.roster.rows[0]!.bioStatus).toBe("none");
  });

  it("offers the lead Archive on members, never on themselves", async () => {
    dbMock.queue([CAMP_A], ROWS);
    const page = await load(ALICE);
    expect(page!.actions).toEqual({ "m-ren": "archive", "m-gone": "archive" });
  });

  it("offers nothing to a roster reader who lacks manage_members", async () => {
    // view_member_details lets them READ the roster; it is not member
    // management, so no row offers them an archive.
    stubs.perms.set(`${CAMP_A.id}:${REN}`, grantedPerms);
    dbMock.queue([CAMP_A], ROWS);
    const page = await load(REN);
    expect(page!.roster.total).toBe(3);
    expect(page!.actions).toEqual({});
  });

  it("offers a manage_members holder Archive on plain members only", async () => {
    stubs.perms.set(`${CAMP_A.id}:${REN}`, {
      structuralRole: MEMBER,
      rolePermissions: [
        {},
        { view_member_details: true, manage_members: true },
      ],
    });
    dbMock.queue(
      [CAMP_A],
      [
        ...ROWS,
        memberRow({
          membershipId: "m-colead",
          userId: JABU,
          role: MembershipRole.enum.admin,
          username: "Jabu",
        }),
      ],
    );
    const page = await load(REN);
    // Not the lead, not the co-lead (lead only), not themselves.
    expect(page!.actions).toEqual({ "m-gone": "archive" });
  });
});

describe("exportCampRosterCsv", () => {
  const exportAs = (viewerUserId: string, searchParams = {}) =>
    exportCampRosterCsv({
      slug: CAMP_A.slug,
      viewerUserId,
      editionId: EDITION.id,
      editionYear: 2027,
      searchParams,
      now: new Date("2027-03-01T08:00:00Z"),
    });

  it("refuses a member without the permission, reading no member rows", async () => {
    dbMock.queue([CAMP_A]);
    expect(await exportAs(REN)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("refuses a lead of another camp and a missing camp", async () => {
    dbMock.queue([CAMP_A]);
    expect(await exportAs(JABU)).toBeNull();
    dbMock.queue([]);
    expect(await exportAs(ALICE)).toBeNull();
  });

  it("hands a lead the CSV, filtered as the page is", async () => {
    dbMock.queue([CAMP_A], ROWS);
    const result = await exportAs(ALICE, { role: "lead" });
    expect(result?.filename).toBe("mad-hatters-2027-roster-2027-03-01.csv");
    const lines = result!.csv.slice(1).trim().split("\r\n");
    expect(lines).toEqual([
      "Name,Burner name,Roles,Arrival,Departure,Joining build,Joining strike",
      "Alice Hatter,Alice Hatter,Lead,2027-04-20,2027-05-03,Yes,No",
    ]);
  });
});

describe("getOwnLogistics", () => {
  const read = () =>
    getOwnLogistics({ slug: CAMP_A.slug, userId: REN, editionId: EDITION.id });

  it("is undefined for a non-member — there is nothing of theirs here", async () => {
    dbMock.queue([]);
    expect(await read()).toBeUndefined();
    expect(dbMock.queriesTouching(schema.membershipLogistics)).toHaveLength(0);
  });

  it("is undefined on an org membership", async () => {
    dbMock.queue([{ id: "m-org", userId: REN, groupKind: ORG }]);
    expect(await read()).toBeUndefined();
  });

  it("is null for a member who has not set any", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }], []);
    expect(await read()).toBeNull();
  });

  it("returns the member's own row", async () => {
    const plan = {
      joiningBuild: false,
      joiningStrike: true,
      arrivalDate: "2027-04-26",
      departureDate: null,
    };
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }], [plan]);
    expect(await read()).toEqual(plan);
    // Looked up by the SESSION user's membership of this slug.
    expect(boundStrings(dbMock.queries[0]!)).toContain(REN);
    expect(boundStrings(dbMock.queries[1]!)).toContain("m-ren");
  });

  it("looks the membership up as a CURRENT one — a former member has no plans to edit here", async () => {
    dbMock.queue([]);
    await read();
    expect(
      nullChecksOn(dbMock.queries[0]!, schema.memberships.archivedAt),
    ).toEqual(["is null"]);
  });
});

describe("saveOwnLogistics", () => {
  const PLAN = {
    joiningBuild: true,
    joiningStrike: true,
    arrivalDate: "2027-04-20",
    departureDate: "2027-05-04",
  };
  const save = (raw: unknown, userId = REN) =>
    saveOwnLogistics({ slug: CAMP_A.slug, userId, edition: EDITION, raw });

  it("refuses a non-member and writes nothing", async () => {
    dbMock.queue([]);
    expect(await save(PLAN)).toEqual({
      ok: false,
      error: "You're not a member of this camp.",
    });
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses an org membership and writes nothing — roster logistics exist only on project kinds", async () => {
    dbMock.queue([{ id: "m-org", userId: REN, groupKind: ORG }]);
    expect(await save(PLAN)).toEqual({
      ok: false,
      error: "You're not a member of this camp.",
    });
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses dates outside the edition window with a human message", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }]);
    const result = await save({ ...PLAN, arrivalDate: "2027-01-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/between 27 March 2027/);
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses arriving after leaving", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }]);
    const result = await save({
      ...PLAN,
      arrivalDate: "2027-05-01",
      departureDate: "2027-04-30",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("refuses a body that names someone else's membership", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }]);
    const result = await save({ ...PLAN, membershipId: "m-alice" });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.membershipLogistics)).toHaveLength(0);
  });

  it("upserts the SESSION user's own membership for this edition", async () => {
    dbMock.queue([{ id: "m-ren", userId: REN, groupKind: THEME_CAMP }]);
    expect(await save(PLAN)).toEqual({ ok: true, logistics: PLAN });
    const write = dbMock.onlyQuery("insert");
    expect(write.arg("insert")).toBe(schema.membershipLogistics);
    expect(write.arg("values")).toMatchObject({
      membershipId: "m-ren",
      editionId: EDITION.id,
      ...PLAN,
    });
    expect(write.called("onConflictDoUpdate")).toBe(true);
    // The membership lookup was keyed by the session user, not the body.
    expect(boundStrings(dbMock.queries[0]!)).toContain(REN);
  });
});

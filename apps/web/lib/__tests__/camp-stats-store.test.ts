import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { schema } from "@quagga/db";
import {
  GroupKind,
  MembershipRole,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";
import { dbMock } from "@/test/db-mock";

// The camp stats store (docs/camp-stats-spec.md): the boundary between the
// database and the @quagga/core stats derivations. What these tests pin is the
// DECISION — who is refused, before which read — that no query names a
// sensitive column, and that the reads are set-based (the same handful of
// queries whatever the camp's size). They cannot prove the SQL (see
// test/db-mock.ts).

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const stubs = vi.hoisted(() => ({
  /** `${groupId}:${userId}` → permission membership; absent ⇒ not a member. */
  perms: new Map<string, unknown>(),
  permCalls: [] as string[],
  tenure: new Map<string, "new" | "returning">(),
  onboardings: [] as unknown[],
  memberships: new Map<string, unknown[]>(),
}));

vi.mock("../roles-store", () => ({
  getMemberPermissions: async (groupId: string, userId: string) => {
    stubs.permCalls.push(`${groupId}:${userId}`);
    return stubs.perms.get(`${groupId}:${userId}`) ?? null;
  },
}));
vi.mock("../camp-tenure", () => ({
  loadCampTenure: async () => stubs.tenure,
}));
vi.mock("../onboarding-store", () => ({
  listOnboardingsForEdition: async () => stubs.onboardings,
}));
vi.mock("../campmates-store", () => ({
  loadCampmateMemberships: async () => stubs.memberships,
}));

const {
  campStatsLinks,
  loadCampStats,
  loadMemberParticipation,
  loadProfileParticipation,
} = await import("../camp-stats-store");

// Values from the real vocabularies (AGENTS.md "Verification": a fixture
// outside the enum is inert). Ids and people are fictional (the cast).
const THEME_CAMP = GroupKind.enum.theme_camp;
const ARTWORK = GroupKind.enum.artwork;
const ORG = GroupKind.enum.org;
const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const GRANTED = WapRequestStatus.enum.granted;
const APPROVED = WapListStatus.enum.approved;

const EDITION = {
  id: "eeeeeeee-0000-4000-8000-000000002027",
  year: 2027,
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};
const NOW = new Date("2027-04-30T08:00:00Z");
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

const leadPerms = { structuralRole: LEAD, rolePermissions: [{}] };
const memberPerms = { structuralRole: MEMBER, rolePermissions: [{}] };

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
  "contactEmail",
];

/** Every column name any select asked for. */
function allSelectedKeys(): string[] {
  return dbMock.queries
    .filter((q) => q.kind === "select")
    .flatMap((q) =>
      Object.keys((q.arg("select") as Record<string, unknown>) ?? {}),
    );
}

/** A current member as the member query returns them. */
function memberRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    membershipId: `m-${i}`,
    sanitizedAt: null,
    bioId: `bio-${i}`,
    bioCompletedAt: new Date("2027-01-10T00:00:00Z"),
    bioFirstTime: false,
    logisticsId: `l-${i}`,
    joiningBuild: true,
    joiningStrike: false,
    arrivalDate: "2027-04-24",
    departureDate: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
  stubs.perms = new Map<string, unknown>([
    [`${CAMP_A.id}:${ALICE}`, leadPerms],
    [`${CAMP_A.id}:${REN}`, memberPerms],
    [`${CAMP_B}:${JABU}`, leadPerms],
  ]);
  stubs.permCalls = [];
  stubs.tenure = new Map();
  stubs.onboardings = [];
  stubs.memberships = new Map();
});

// Tables that hold a member's facts. A refusal must leave every one unread.
const MEMBER_TABLES = [
  schema.memberships,
  schema.burnerBios,
  schema.membershipLogistics,
  schema.shifts,
  schema.shiftAssignments,
  schema.wapAllocations,
  schema.wapRequests,
  schema.requiredActions,
];

function expectNothingRead() {
  for (const table of MEMBER_TABLES) {
    expect(dbMock.queriesTouching(table)).toHaveLength(0);
  }
}

describe("loadCampStats — refusals", () => {
  const load = (viewerUserId: string, slug = CAMP_A.slug) =>
    loadCampStats({ slug, viewerUserId, edition: EDITION, now: NOW });

  it("refuses a slug that does not exist, without asking about permissions", async () => {
    dbMock.queue([]);
    expect(await load(ALICE, "no-such-camp")).toBeNull();
    expect(stubs.permCalls).toHaveLength(0);
    expectNothingRead();
  });

  it("refuses the org group", async () => {
    dbMock.queue([{ ...CAMP_A, kind: ORG }]);
    expect(await load(ALICE)).toBeNull();
    expectNothingRead();
  });

  it("refuses a non-member BEFORE any member row is read", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load("aaaaaaaa-0000-4000-8000-0000000000ff")).toBeNull();
    expectNothingRead();
  });

  it("refuses a member without view_member_details the same way", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load(REN)).toBeNull();
    expectNothingRead();
  });

  it("refuses a lead of ANOTHER camp — permission is looked up for THIS camp", async () => {
    dbMock.queue([CAMP_A]);
    expect(await load(JABU)).toBeNull();
    expect(stubs.permCalls).toEqual([`${CAMP_A.id}:${JABU}`]);
    expectNothingRead();
  });

  it("refuses an artwork's lead (theme camps only in this epic)", async () => {
    dbMock.queue([{ ...CAMP_A, kind: ARTWORK }]);
    expect(await load(ALICE)).toBeNull();
    expectNothingRead();
  });
});

describe("loadCampStats — a roster viewer", () => {
  /** Queue one full page's worth of answers, in query order. */
  function queuePage(members: unknown[]) {
    dbMock.queue(
      [CAMP_A],
      members,
      // Former: one live, one deleted.
      [{ sanitizedAt: null }, { sanitizedAt: new Date("2026-09-01") }],
      // Shifts.
      [
        {
          date: "2027-04-30",
          capacity: 4,
          filled: 3,
          teamId: "t-1",
          teamName: "Kitchen",
          teamSort: 0,
        },
      ],
      // Registration.
      [{ id: "reg-1", listStatus: APPROVED, allocated: 2 }],
      // Requests.
      [{ requested: 5, status: GRANTED, granted: 4 }],
      // Onboarding rows.
      [
        { status: "completed", openedAt: new Date() },
        { status: "pending", openedAt: new Date() },
        { status: "pending", openedAt: null },
      ],
    );
  }

  it("counts the camp, leaving deleted accounts and former members out of current", async () => {
    stubs.tenure = new Map([
      ["m-1", "new"],
      ["m-2", "returning"],
    ]);
    stubs.onboardings = [
      { activationId: "draft-1", title: "Unsent", status: "draft" },
      { activationId: "act-1", title: "Welcome", status: "open" },
    ];
    queuePage([
      memberRow(1, { bioFirstTime: true }),
      memberRow(2, { bioCompletedAt: null, arrivalDate: null }),
      memberRow(9, {
        sanitizedAt: new Date("2026-09-01"),
        bioFirstTime: true,
      }),
    ]);
    const page = await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    expect(page).not.toBeNull();
    expect(dbMock.pending).toBe(0);
    const { stats } = page!;
    expect(stats.people).toEqual({
      current: 2,
      newToCamp: 1,
      returning: 1,
      firstBurn: 1,
      former: 1,
    });
    expect(stats.bios).toEqual({ complete: 1, incomplete: 1 });
    expect(stats.buildStrike).toMatchObject({
      joiningBuild: 2,
      arrivalNotSet: 1,
    });
    // The SENT onboarding, never the draft.
    expect(stats.onboarding).toEqual({
      activationId: "act-1",
      title: "Welcome",
      targeted: 3,
      completed: 1,
      inProgress: 1,
      notStarted: 1,
    });
    expect(stats.shifts).toMatchObject({ spots: 4, filled: 3, open: 1 });
    expect(stats.shifts!.nextSevenDays.shifts).toBe(1);
    expect(stats.passes).toEqual({
      granted: 4,
      allocated: 2,
      left: 2,
      listStatus: APPROVED,
      pending: null,
    });
  });

  it("hides onboarding, shifts and passes when there are none", async () => {
    dbMock.queue([CAMP_A], [memberRow(1)], [], [], []);
    const page = await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    expect(page!.stats.onboarding).toBeNull();
    expect(page!.stats.shifts).toBeNull();
    expect(page!.stats.passes).toBeNull();
    // Nothing sent and no registration: those follow-up reads never run.
    expect(dbMock.queriesTouching(schema.requiredActions)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.wapRequests)).toHaveLength(0);
  });

  it("never selects a sensitive column", async () => {
    stubs.onboardings = [{ activationId: "act-1", title: "W", status: "open" }];
    queuePage([memberRow(1)]);
    await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    const keys = allSelectedKeys();
    expect(keys).toContain("bioCompletedAt");
    for (const column of SENSITIVE) expect(keys).not.toContain(column);
  });

  it("renders SQL Postgres can run: no bare, ambiguous column in a subquery", async () => {
    // The mock cannot run SQL, but it records every builder chain — replayed
    // onto drizzle's REAL query builder, it renders the exact SQL the page
    // sends. A one-table select renders unqualified columns, subqueries
    // included, so a correlated count over memberships became `"id" = "id"`
    // and Postgres refused the whole page (found by the local e2e).
    stubs.onboardings = [{ activationId: "act-1", title: "W", status: "open" }];
    queuePage([memberRow(1)]);
    await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    const rendered = dbMock
      .queriesOfKind("select")
      .map((q) => {
        let chain: unknown = new QueryBuilder();
        for (const c of q.calls) {
          chain = (chain as Record<string, (...a: unknown[]) => unknown>)[
            c.method
          ]!(...c.args);
        }
        return (chain as { toSQL(): { sql: string } }).toSQL().sql;
      })
      .filter((sql) => /\(\s*select count/.test(sql));
    expect(rendered.length).toBeGreaterThanOrEqual(2);
    for (const sql of rendered) {
      // Every "id" is table-qualified ("memberships"."id"), never bare.
      expect(sql).not.toMatch(/(?<!\.)"id"/);
    }
  });

  it("is set-based: the same queries for 2 members as for 60", async () => {
    stubs.onboardings = [{ activationId: "act-1", title: "W", status: "open" }];
    queuePage([memberRow(1), memberRow(2)]);
    await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    const small = dbMock.queries.length;

    dbMock.reset();
    queuePage(Array.from({ length: 60 }, (_, i) => memberRow(i)));
    await loadCampStats({
      slug: CAMP_A.slug,
      viewerUserId: ALICE,
      edition: EDITION,
      now: NOW,
    });
    expect(dbMock.queries.length).toBe(small);
    // A handful, not a loop.
    expect(small).toBeLessThanOrEqual(8);
  });
});

// --- Participation -------------------------------------------------------------

describe("loadMemberParticipation", () => {
  const subjectRow = (overrides: Record<string, unknown> = {}) => ({
    membershipId: "m-ren",
    role: MEMBER,
    createdAt: new Date("2025-02-01T00:00:00Z"),
    sanitizedAt: null,
    ...overrides,
  });

  /** Answers after the group and subject reads, in query order. */
  function queueDetail(bio: Record<string, unknown> | null) {
    dbMock.queue(
      [{ id: "r-kitchen", name: "Kitchen wizard" }], // roles
      [
        {
          editionId: EDITION.id,
          year: 2027,
          joiningBuild: true,
          joiningStrike: false,
          arrivalDate: "2027-04-24",
          departureDate: null,
        },
      ], // logistics
      [
        { year: 2025, endDate: "2025-05-04" },
        { year: 2026, endDate: "2026-05-03" },
        { year: 2027, endDate: "2027-05-02" },
      ], // editions
      [
        { date: "2027-04-28", editionYear: 2027 },
        { date: "2026-04-30", editionYear: 2026 },
      ], // shift spots
      [
        { year: 2027, listStatus: APPROVED },
        { year: 2026, listStatus: APPROVED },
      ], // passes
      bio ? [bio] : [], // bio
    );
  }

  const load = (viewerUserId: string, subjectUserId = REN) =>
    loadMemberParticipation({
      slug: CAMP_A.slug,
      viewerUserId,
      subjectUserId,
      edition: EDITION,
      now: NOW,
    });

  it("refuses a plain member looking at a camp-mate, before the bio is read", async () => {
    dbMock.queue([CAMP_A], [subjectRow({ membershipId: "m-alice" })]);
    expect(await load(REN, ALICE)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.shiftAssignments)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.wapAllocations)).toHaveLength(0);
  });

  it("refuses a lead of another camp", async () => {
    dbMock.queue([CAMP_A], [subjectRow()]);
    expect(await load(JABU)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("refuses when the subject is not a current member of this camp", async () => {
    dbMock.queue([CAMP_A], []);
    expect(await load(ALICE)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("refuses a deleted account, even for the lead", async () => {
    dbMock.queue(
      [CAMP_A],
      [subjectRow({ sanitizedAt: new Date("2026-09-01") })],
    );
    expect(await load(ALICE)).toBeNull();
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("a lead sees the summary; bio fields the member keeps private stay hidden", async () => {
    stubs.memberships = new Map([
      [ALICE, [{ groupId: CAMP_A.id, groupKind: THEME_CAMP }]],
      [REN, [{ groupId: CAMP_A.id, groupKind: THEME_CAMP }]],
    ]);
    dbMock.queue([CAMP_A], [subjectRow()]);
    queueDetail({
      skills: ["Cooking"],
      attendedYears: [2023, 2025, 2026],
      privacyFlags: { attendedYears: false, skills: false },
      completedAt: new Date("2027-01-10T00:00:00Z"),
    });
    const out = await load(ALICE);
    expect(out).not.toBeNull();
    expect(out!.burnsAttended).toBeNull();
    expect(out!.skills).toBeNull();
    expect(out!.withCampSince).toBe(2025);
    expect(out!.shiftsHeldThisEdition).toBe(1);
    expect(out!.shiftsHeldEarlier).toBe(1);
    expect(out!.buildStrike).toEqual({
      joiningBuild: true,
      joiningStrike: false,
    });
    expect(out!.onboarding).toBeNull();
    expect(out!.roles.projectRoles).toEqual([
      { id: "r-kitchen", name: "Kitchen wizard" },
    ]);
    expect(out!.passes).toEqual({
      thisEdition: APPROVED,
      earlierYears: [2026],
    });
  });

  it("a lead who shares the camp sees what the member shared with camp-mates", async () => {
    stubs.memberships = new Map([
      [ALICE, [{ groupId: CAMP_A.id, groupKind: THEME_CAMP }]],
      [REN, [{ groupId: CAMP_A.id, groupKind: THEME_CAMP }]],
    ]);
    dbMock.queue([CAMP_A], [subjectRow()]);
    queueDetail({
      skills: ["Cooking"],
      attendedYears: [2023, 2025, 2026],
      privacyFlags: { attendedYears: "camp_mates", skills: "camp_mates" },
      completedAt: new Date("2027-01-10T00:00:00Z"),
    });
    const out = await load(ALICE);
    expect(out!.burnsAttended).toBe(3);
    expect(out!.skills).toEqual(["Cooking"]);
  });

  it("the member sees their own, and their onboarding status", async () => {
    stubs.onboardings = [{ activationId: "act-1", title: "W", status: "open" }];
    dbMock.queue([CAMP_A], [subjectRow()]);
    queueDetail({
      skills: ["Cooking"],
      attendedYears: [2025],
      privacyFlags: { attendedYears: false, skills: false },
      completedAt: null,
    });
    dbMock.queue([{ status: "pending", openedAt: new Date() }]);
    const out = await load(REN);
    expect(out!.burnsAttended).toBe(1);
    expect(out!.skills).toEqual(["Cooking"]);
    expect(out!.onboarding).toBe("in_progress");
    expect(dbMock.pending).toBe(0);
  });

  it("selects only skills, attended years, flags and completion from the bio", async () => {
    dbMock.queue([CAMP_A], [subjectRow()]);
    queueDetail(null);
    await load(REN);
    const bioQuery = dbMock.queriesTouching(schema.burnerBios);
    expect(bioQuery).toHaveLength(1);
    expect(
      Object.keys(bioQuery[0]!.arg("select") as Record<string, unknown>).sort(),
    ).toEqual(["attendedYears", "completedAt", "privacyFlags", "skills"]);
    for (const column of SENSITIVE) {
      expect(allSelectedKeys()).not.toContain(column);
    }
  });
});

// --- The lists behind the figures ----------------------------------------------

describe("campStatsLinks", () => {
  it("a lead may open the onboarding results and the passes page", () => {
    expect(
      campStatsLinks(CAMP_A, {
        groupKind: THEME_CAMP,
        viewerMembership: leadPerms as never,
      }),
    ).toEqual({ onboardingResults: true, passes: true });
  });

  it("a custom-role roster viewer may open neither (lead/co-lead pages)", () => {
    const rosterViewer = {
      structuralRole: MEMBER,
      rolePermissions: [{ view_member_details: true }],
    };
    expect(
      campStatsLinks(CAMP_A, {
        groupKind: THEME_CAMP,
        viewerMembership: rosterViewer as never,
      }),
    ).toEqual({ onboardingResults: false, passes: false });
  });
});

// --- On a burner's profile -----------------------------------------------------

describe("loadProfileParticipation", () => {
  const subject = {
    membershipId: "m-ren",
    role: MEMBER,
    createdAt: new Date("2025-02-01T00:00:00Z"),
    sanitizedAt: null,
  };
  const load = (viewerUserId: string, subjectUserId = REN) =>
    loadProfileParticipation({
      viewerUserId,
      subjectUserId,
      edition: EDITION,
      now: NOW,
    });

  it("is empty when the two share no camp, and asks about no permission", async () => {
    dbMock.queue([]);
    expect(await load(JABU)).toEqual([]);
    expect(stubs.permCalls).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  // Each refusal queues the FULL answers a summary would need, so the test
  // goes red if the profile's own predicate is dropped (the summary loader
  // would then find everything it needs).
  const queueAll = (subjectRow: unknown) =>
    dbMock.queue([CAMP_A], [CAMP_A], [subjectRow], [], [], [], [], [], []);

  it("is empty for a plain camp-mate — nothing about the subject is read", async () => {
    queueAll({ ...subject, membershipId: "m-alice", role: LEAD });
    expect(await load(REN, ALICE)).toEqual([]);
    expect(stubs.permCalls).toEqual([`${CAMP_A.id}:${REN}`]);
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
    expect(dbMock.queriesTouching(schema.shiftAssignments)).toHaveLength(0);
  });

  it("is empty for a plain member on their OWN profile (their card is on the camp page)", async () => {
    queueAll(subject);
    expect(await load(REN, REN)).toEqual([]);
    expect(dbMock.queriesTouching(schema.burnerBios)).toHaveLength(0);
  });

  it("gives a roster viewer one block per camp they may view", async () => {
    dbMock.queue([CAMP_A], [CAMP_A], [subject], [], [], [], [], [], []);
    const blocks = await load(ALICE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.camp).toEqual({ name: CAMP_A.name, slug: CAMP_A.slug });
    expect(blocks[0]!.participation.withCampSince).toBe(2027);
    expect(dbMock.pending).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  GroupKind,
  MembershipRole,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";

import { defaultPrivacyFlags, type BurnerBioFields } from "../bio";
import type { RosterAccessContext } from "../camp-roster";
import {
  buildCampStats,
  buildMemberParticipation,
  campSinceYear,
  campStatsToday,
  canViewCampStats,
  canViewMemberParticipation,
  deriveBuildStrikeStats,
  deriveOnboardingStats,
  derivePassStats,
  deriveShiftStats,
  isShiftDayPassed,
  onboardingStatusOf,
  participationBioView,
  type CampStatsInput,
  type CampStatsMemberInput,
  type CampStatsShiftInput,
  type MemberParticipationInput,
} from "../camp-stats";

// Values from the real vocabularies (AGENTS.md "Verification": a fixture
// outside the enum is inert). Ids and people are fictional (the cast).
const THEME_CAMP = GroupKind.enum.theme_camp;
const ARTWORK = GroupKind.enum.artwork;
const ORG = GroupKind.enum.org;
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
const GRANTED = WapRequestStatus.enum.granted;
const PENDING_ASK = WapRequestStatus.enum.pending;
const DECLINED = WapRequestStatus.enum.declined;
const APPROVED = WapListStatus.enum.approved;
const DRAFT = WapListStatus.enum.draft;
/** required_action_status values (packages/db schema `requiredActionStatusEnum`). */
const RA = {
  pending: "pending",
  completed: "completed",
  waived: "waived",
  expired: "expired",
} as const;

const EDITION = { startDate: "2027-04-26", endDate: "2027-05-02" };
const TODAY = "2027-04-30";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // member
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // member
const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const CAMP_B = "11111111-0000-4000-8000-00000000000b";

const leadAccess: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: { structuralRole: LEAD, rolePermissions: [{}] },
};
const memberAccess: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: { structuralRole: MEMBER, rolePermissions: [{}] },
};
const grantedAccess: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: {
    structuralRole: MEMBER,
    rolePermissions: [{}, { view_member_details: true }],
  },
};
const noAccess: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: null,
};

function member(
  overrides: Partial<CampStatsMemberInput> = {},
): CampStatsMemberInput {
  return {
    sanitized: false,
    tenure: "returning",
    bio: { completedAt: new Date("2027-01-10T00:00:00Z"), firstTime: false },
    logistics: null,
    ...overrides,
  };
}

function logistics(
  arrivalDate: string | null,
  joiningBuild = false,
  joiningStrike = false,
) {
  return { joiningBuild, joiningStrike, arrivalDate, departureDate: null };
}

function shift(
  overrides: Partial<CampStatsShiftInput> = {},
): CampStatsShiftInput {
  return {
    date: "2027-04-28",
    capacity: 4,
    filled: 4,
    teamId: "t-kitchen",
    teamName: "Kitchen",
    teamSort: 0,
    ...overrides,
  };
}

function statsInput(overrides: Partial<CampStatsInput> = {}): CampStatsInput {
  return {
    access: leadAccess,
    edition: EDITION,
    today: TODAY,
    current: [],
    former: [],
    onboarding: null,
    shifts: [],
    passes: null,
    ...overrides,
  };
}

// --- Access ------------------------------------------------------------------

describe("canViewCampStats — the roster's own predicate", () => {
  it("lets the lead, a co-lead and a view_member_details holder in", () => {
    expect(canViewCampStats(leadAccess)).toBe(true);
    expect(
      canViewCampStats({
        groupKind: THEME_CAMP,
        viewerMembership: { structuralRole: ADMIN, rolePermissions: [{}] },
      }),
    ).toBe(true);
    expect(canViewCampStats(grantedAccess)).toBe(true);
  });

  it("refuses a plain member and a non-member", () => {
    expect(canViewCampStats(memberAccess)).toBe(false);
    expect(canViewCampStats(noAccess)).toBe(false);
  });

  it("refuses the org group and (this epic) artworks", () => {
    expect(canViewCampStats({ ...leadAccess, groupKind: ORG })).toBe(false);
    expect(canViewCampStats({ ...leadAccess, groupKind: ARTWORK })).toBe(false);
  });

  it("buildCampStats returns null for a refused viewer, whatever the input", () => {
    const input = statsInput({
      access: memberAccess,
      current: [member(), member()],
    });
    expect(buildCampStats(input)).toBeNull();
    expect(buildCampStats({ ...input, access: noAccess })).toBeNull();
  });
});

describe("canViewMemberParticipation", () => {
  const base = {
    viewerUserId: REN,
    subjectUserId: REN,
    subjectInGroup: true,
    access: memberAccess,
  };

  it("the member themself — no roster permission needed", () => {
    expect(canViewMemberParticipation(base)).toBe(true);
  });

  it("a plain member may not see a camp-mate's", () => {
    expect(canViewMemberParticipation({ ...base, subjectUserId: JABU })).toBe(
      false,
    );
  });

  it("a roster viewer may see a member's", () => {
    expect(
      canViewMemberParticipation({
        ...base,
        viewerUserId: ALICE,
        access: leadAccess,
      }),
    ).toBe(true);
  });

  it("refuses when the subject is not a current member of THIS camp", () => {
    expect(
      canViewMemberParticipation({
        ...base,
        viewerUserId: ALICE,
        access: leadAccess,
        subjectInGroup: false,
      }),
    ).toBe(false);
    // Not even for themself (a former member has no card).
    expect(canViewMemberParticipation({ ...base, subjectInGroup: false })).toBe(
      false,
    );
  });
});

// --- Dates ---------------------------------------------------------------------

describe("campStatsToday / isShiftDayPassed", () => {
  it("is the South African calendar day", () => {
    // 23:30 UTC on the 29th is 01:30 on the 30th in Johannesburg.
    expect(campStatsToday(new Date("2027-04-29T23:30:00Z"))).toBe("2027-04-30");
    expect(campStatsToday(new Date("2027-04-29T21:59:00Z"))).toBe("2027-04-29");
  });

  it("a shift today has not been held yet; yesterday's has", () => {
    expect(isShiftDayPassed("2027-04-30", TODAY)).toBe(false);
    expect(isShiftDayPassed("2027-04-29", TODAY)).toBe(true);
    expect(isShiftDayPassed("2027-05-01", TODAY)).toBe(false);
  });
});

// --- The camp page -------------------------------------------------------------

describe("buildCampStats — people", () => {
  it("counts current, new to the camp, returning and first burn ever", () => {
    const stats = buildCampStats(
      statsInput({
        current: [
          member({
            tenure: "new",
            bio: { completedAt: null, firstTime: true },
          }),
          member({ tenure: "new", bio: null }),
          member({ tenure: "returning" }),
          // A veteran burner new to THIS camp: new, not a first burn.
          member({ tenure: "new" }),
        ],
      }),
    )!;
    expect(stats.people).toEqual({
      current: 4,
      newToCamp: 3,
      returning: 1,
      firstBurn: 1,
      former: 0,
    });
  });

  it("a former member counts only as former", () => {
    const stats = buildCampStats(
      statsInput({ current: [member()], former: [{ sanitized: false }] }),
    )!;
    expect(stats.people.current).toBe(1);
    expect(stats.people.former).toBe(1);
    expect(stats.bios.complete + stats.bios.incomplete).toBe(1);
  });

  it("a deleted (sanitised) account counts nowhere — current or former", () => {
    const gone = member({
      sanitized: true,
      tenure: "new",
      bio: { completedAt: new Date(), firstTime: true },
      logistics: logistics("2027-04-24", true, true),
    });
    const stats = buildCampStats(
      statsInput({
        current: [member(), gone],
        former: [{ sanitized: true }],
      }),
    )!;
    expect(stats.people).toEqual({
      current: 1,
      newToCamp: 0,
      returning: 1,
      firstBurn: 0,
      former: 0,
    });
    expect(stats.bios).toEqual({ complete: 1, incomplete: 0 });
    expect(stats.buildStrike.joiningBuild).toBe(0);
    expect(stats.buildStrike.arrivalsByDay).toEqual([]);
  });

  it("an empty camp is all zeros, with nothing hidden that needs data", () => {
    const stats = buildCampStats(statsInput())!;
    expect(stats.people.current).toBe(0);
    expect(stats.onboarding).toBeNull();
    expect(stats.shifts).toBeNull();
    expect(stats.passes).toBeNull();
  });
});

describe("buildCampStats — bios", () => {
  it("complete is a confirmed bio; no bio and unconfirmed are incomplete", () => {
    const stats = buildCampStats(
      statsInput({
        current: [
          member(),
          member({ bio: { completedAt: null, firstTime: false } }),
          member({ bio: null }),
        ],
      }),
    )!;
    expect(stats.bios).toEqual({ complete: 1, incomplete: 2 });
  });
});

describe("deriveBuildStrikeStats", () => {
  it("counts build, strike, arrival not set, and arrivals per day with phase", () => {
    const out = deriveBuildStrikeStats(
      [
        { logistics: logistics("2027-04-22", true, false) },
        { logistics: logistics("2027-04-22", true, true) },
        { logistics: logistics("2027-04-26", false, true) },
        { logistics: logistics("2027-05-03") },
        { logistics: logistics(null, true) },
        { logistics: null },
      ],
      EDITION,
    );
    expect(out.joiningBuild).toBe(3);
    expect(out.joiningStrike).toBe(2);
    expect(out.arrivalNotSet).toBe(2);
    expect(out.arrivalsByDay).toEqual([
      { date: "2027-04-22", phase: "build", count: 2 },
      { date: "2027-04-26", phase: "event", count: 1 },
      { date: "2027-05-03", phase: "strike", count: 1 },
    ]);
  });
});

describe("deriveOnboardingStats", () => {
  it("is null when nothing was sent", () => {
    expect(deriveOnboardingStats(null)).toBeNull();
  });

  it("splits completed / in progress / not started; waived drops out", () => {
    const out = deriveOnboardingStats({
      activationId: "act-1",
      title: "Welcome to the camp",
      rows: [
        { status: RA.completed, tenure: "new", started: true },
        { status: RA.completed, tenure: "returning" },
        { status: RA.pending, tenure: "new", started: true },
        { status: RA.pending, tenure: "new", started: false },
        { status: RA.expired, tenure: "new" },
        { status: RA.waived, tenure: "new", started: true },
      ],
    });
    expect(out).toEqual({
      activationId: "act-1",
      title: "Welcome to the camp",
      targeted: 5,
      completed: 2,
      inProgress: 1,
      notStarted: 2,
    });
  });

  it("onboardingStatusOf agrees with the tally", () => {
    expect(onboardingStatusOf({ status: RA.completed })).toBe("completed");
    expect(onboardingStatusOf({ status: RA.pending, started: true })).toBe(
      "in_progress",
    );
    expect(onboardingStatusOf({ status: RA.pending })).toBe("not_started");
    expect(onboardingStatusOf({ status: RA.waived, started: true })).toBeNull();
  });
});

describe("deriveShiftStats", () => {
  it("is null when the camp has no shifts", () => {
    expect(deriveShiftStats([], TODAY)).toBeNull();
  });

  it("totals spots filled and open, overall and by team", () => {
    const out = deriveShiftStats(
      [
        shift({ capacity: 4, filled: 3 }),
        shift({ capacity: 2, filled: 2 }),
        shift({
          teamId: "t-tea",
          teamName: "Tea bar",
          teamSort: 1,
          capacity: 3,
          filled: 1,
        }),
        shift({
          teamId: null,
          teamName: null,
          teamSort: null,
          capacity: 2,
          filled: 0,
        }),
        // Over-filled rows never count more than their capacity.
        shift({ capacity: 1, filled: 3 }),
      ],
      TODAY,
    )!;
    expect(out.shifts).toBe(5);
    expect(out.spots).toBe(12);
    expect(out.filled).toBe(7);
    expect(out.open).toBe(5);
    expect(out.percentFilled).toBe(58);
    expect(out.byTeam).toEqual([
      { teamId: "t-kitchen", name: "Kitchen", spots: 7, filled: 6, open: 1 },
      { teamId: "t-tea", name: "Tea bar", spots: 3, filled: 1, open: 2 },
      { teamId: null, name: "No team", spots: 2, filled: 0, open: 2 },
    ]);
  });

  it("open in the next 7 days: today through six days on, open spots only", () => {
    const out = deriveShiftStats(
      [
        shift({ date: "2027-04-29", filled: 0 }), // yesterday — out
        shift({ date: "2027-04-30", capacity: 3, filled: 2 }), // today — in
        shift({ date: "2027-04-30", capacity: 2, filled: 2 }), // full — out
        shift({ date: "2027-05-02", capacity: 2, filled: 1 }),
        shift({ date: "2027-05-03", capacity: 4, filled: 2 }),
        shift({ date: "2027-05-06", capacity: 1, filled: 0 }), // day 7 — in
        shift({ date: "2027-05-07", capacity: 1, filled: 0 }), // day 8 — out
      ],
      TODAY,
    )!;
    expect(out.nextSevenDays).toEqual({
      from: "2027-04-30",
      to: "2027-05-06",
      shifts: 4,
      openSpots: 5,
      days: [
        { date: "2027-04-30", shifts: 1, openSpots: 1 },
        { date: "2027-05-02", shifts: 1, openSpots: 1 },
        { date: "2027-05-03", shifts: 1, openSpots: 2 },
        { date: "2027-05-06", shifts: 1, openSpots: 1 },
      ],
    });
  });
});

describe("derivePassStats", () => {
  it("is null when the camp has no registration or asked for none", () => {
    expect(derivePassStats(null)).toBeNull();
    expect(
      derivePassStats({ requests: [], allocated: 0, listStatus: DRAFT }),
    ).toBeNull();
  });

  it("granted sums granted asks only; left never goes negative", () => {
    expect(
      derivePassStats({
        requests: [
          { requested: 10, status: GRANTED, granted: 8 },
          { requested: 4, status: GRANTED, granted: 2 },
          { requested: 5, status: DECLINED, granted: null },
          { requested: 3, status: PENDING_ASK, granted: null },
        ],
        allocated: 7,
        listStatus: APPROVED,
      }),
    ).toEqual({
      granted: 10,
      allocated: 7,
      left: 3,
      listStatus: APPROVED,
      pending: 3,
    });
    expect(
      derivePassStats({
        requests: [{ requested: 2, status: GRANTED, granted: 2 }],
        allocated: 3,
        listStatus: APPROVED,
      })!.left,
    ).toBe(0);
  });

  it("a camp that asked and was declined still shows the card (0 granted)", () => {
    expect(
      derivePassStats({
        requests: [{ requested: 5, status: DECLINED, granted: null }],
        allocated: 0,
        listStatus: DRAFT,
      }),
    ).toMatchObject({ granted: 0, left: 0 });
  });
});

describe("CampStatsView carries no names and no private fields", () => {
  it("the whole output is numbers, dates, ids, statuses and team names", () => {
    const stats = buildCampStats(
      statsInput({
        current: [member({ logistics: logistics("2027-04-24", true) })],
        onboarding: {
          activationId: "act-1",
          title: "Welcome",
          rows: [{ status: RA.pending, tenure: "new" }],
        },
        shifts: [shift()],
        passes: {
          requests: [{ requested: 1, status: GRANTED, granted: 1 }],
          allocated: 1,
          listStatus: APPROVED,
        },
      }),
    )!;
    const json = JSON.stringify(stats);
    for (const word of [
      "phone",
      "medical",
      "emergency",
      "passport",
      "saId",
      "displayName",
      "username",
      "userId",
    ]) {
      expect(json).not.toContain(word);
    }
  });
});

// --- Per person ----------------------------------------------------------------

function bioFields(overrides: Partial<BurnerBioFields> = {}): BurnerBioFields {
  return {
    legalName: null,
    homeCity: null,
    bio: null,
    skills: ["Cooking", "Carpentry"],
    attendedYears: [2023, 2025, 2026],
    firstTime: false,
    contactEmail: null,
    phone: null,
    onsiteContactName: null,
    onsiteContactPhone: null,
    offsiteContactName: null,
    offsiteContactPhone: null,
    medicalNotes: null,
    idType: null,
    idNumber: null,
    ...overrides,
  };
}

const sameCamp = (viewer: string, subject: string) => ({
  viewerUserId: viewer,
  subjectUserId: subject,
  viewerMemberships: [{ groupId: CAMP_A, groupKind: THEME_CAMP }],
  subjectMemberships: [{ groupId: CAMP_A, groupKind: THEME_CAMP }],
});

describe("participationBioView — never wider than the profile", () => {
  it("is null when there is no bio this edition", () => {
    expect(
      participationBioView({ ctx: sameCamp(ALICE, REN), bio: null }),
    ).toBeNull();
  });

  it("the member themself sees their own fields whatever the flags say", () => {
    const view = participationBioView({
      ctx: sameCamp(REN, REN),
      bio: {
        fields: bioFields(),
        privacyFlags: { attendedYears: false, skills: false },
        confirmed: false,
      },
    });
    expect(view).toEqual({
      attendedYears: [2023, 2025, 2026],
      skills: ["Cooking", "Carpentry"],
    });
  });

  it("a camp-mate sees camp-mate-shared fields of a confirmed bio", () => {
    const view = participationBioView({
      ctx: sameCamp(ALICE, REN),
      bio: {
        fields: bioFields(),
        privacyFlags: { attendedYears: "camp_mates", skills: "camp_mates" },
        confirmed: true,
      },
    });
    expect(view!.attendedYears).toEqual([2023, 2025, 2026]);
    expect(view!.skills).toEqual(["Cooking", "Carpentry"]);
  });

  it("a field kept private is hidden from a lead of the same camp", () => {
    const view = participationBioView({
      ctx: sameCamp(ALICE, REN),
      bio: {
        fields: bioFields(),
        privacyFlags: { attendedYears: false, skills: false },
        confirmed: true,
      },
    });
    expect(view).toEqual({ attendedYears: [], skills: [] });
  });

  it("an UNCONFIRMED bio falls back to the public projection only", () => {
    const view = participationBioView({
      ctx: sameCamp(ALICE, REN),
      bio: {
        fields: bioFields(),
        privacyFlags: { attendedYears: "camp_mates", skills: true },
        confirmed: false,
      },
    });
    expect(view).toEqual({
      attendedYears: [],
      skills: ["Cooking", "Carpentry"],
    });
  });

  it("without a shared camp, only public fields show", () => {
    const view = participationBioView({
      ctx: {
        viewerUserId: ALICE,
        subjectUserId: REN,
        viewerMemberships: [{ groupId: CAMP_B, groupKind: THEME_CAMP }],
        subjectMemberships: [{ groupId: CAMP_A, groupKind: THEME_CAMP }],
      },
      bio: {
        fields: bioFields(),
        privacyFlags: {
          ...defaultPrivacyFlags(),
          attendedYears: "camp_mates",
          skills: "camp_mates",
        },
        confirmed: true,
      },
    });
    expect(view).toEqual({ attendedYears: [], skills: [] });
  });
});

describe("campSinceYear", () => {
  const editions = [
    { year: 2025, endDate: "2025-05-04" },
    { year: 2026, endDate: "2026-05-03" },
    { year: 2027, endDate: "2027-05-02" },
  ];

  it("is the first edition that had not ended when the membership began", () => {
    expect(
      campSinceYear({
        membershipCreatedAt: new Date("2025-02-01T00:00:00Z"),
        logisticsEditionYears: [],
        editions,
        currentYear: 2027,
      }),
    ).toBe(2025);
    // Joined after the 2025 burn ended ⇒ with the camp since 2026.
    expect(
      campSinceYear({
        membershipCreatedAt: new Date("2025-06-01T00:00:00Z"),
        logisticsEditionYears: [],
        editions,
        currentYear: 2027,
      }),
    ).toBe(2026);
  });

  it("earlier logistics pull it back; it never passes the current edition", () => {
    expect(
      campSinceYear({
        membershipCreatedAt: new Date("2026-09-01T00:00:00Z"),
        logisticsEditionYears: [2026],
        editions,
        currentYear: 2027,
      }),
    ).toBe(2026);
    expect(
      campSinceYear({
        membershipCreatedAt: new Date("2027-06-01T00:00:00Z"),
        logisticsEditionYears: [],
        editions,
        currentYear: 2027,
      }),
    ).toBe(2027);
  });
});

function participation(
  overrides: Partial<MemberParticipationInput> = {},
): MemberParticipationInput {
  return {
    viewerUserId: ALICE,
    access: leadAccess,
    subject: {
      userId: JABU,
      inGroup: true,
      sanitized: false,
      structuralRole: MEMBER,
      projectRoles: [{ id: "r-kitchen", name: "Kitchen wizard" }],
      membershipCreatedAt: new Date("2025-02-01T00:00:00Z"),
    },
    bio: { attendedYears: [2023, 2025, 2026], skills: ["Cooking"] },
    edition: { year: 2027 },
    editions: [
      { year: 2025, endDate: "2025-05-04" },
      { year: 2026, endDate: "2026-05-03" },
      { year: 2027, endDate: "2027-05-02" },
    ],
    logisticsEditionYears: [2027],
    logistics: logistics("2027-04-26"),
    shifts: [],
    today: TODAY,
    onboarding: { status: RA.pending, started: true },
    passes: { thisEdition: APPROVED, earlierYears: [2026] },
    ...overrides,
  };
}

describe("buildMemberParticipation", () => {
  it("summarises a member for a roster viewer", () => {
    expect(buildMemberParticipation(participation())).toEqual({
      burnsAttended: 3,
      withCampSince: 2025,
      shiftsHeldThisEdition: 0,
      shiftsHeldEarlier: 0,
      buildStrike: { joiningBuild: false, joiningStrike: false },
      onboarding: "in_progress",
      roles: {
        structural: MEMBER,
        projectRoles: [{ id: "r-kitchen", name: "Kitchen wizard" }],
      },
      skills: ["Cooking"],
      passes: { thisEdition: APPROVED, earlierYears: [2026] },
    });
  });

  it("refuses a plain member looking at someone else", () => {
    expect(
      buildMemberParticipation(
        participation({ viewerUserId: REN, access: memberAccess }),
      ),
    ).toBeNull();
  });

  it("the member themself always sees their own", () => {
    expect(
      buildMemberParticipation(
        participation({ viewerUserId: JABU, access: memberAccess }),
      ),
    ).not.toBeNull();
  });

  it("a deleted (sanitised) account has no summary, even for a lead", () => {
    const input = participation();
    expect(
      buildMemberParticipation({
        ...input,
        subject: { ...input.subject, sanitized: true },
      }),
    ).toBeNull();
  });

  it("a former member has no summary", () => {
    const input = participation();
    expect(
      buildMemberParticipation({
        ...input,
        subject: { ...input.subject, inGroup: false },
      }),
    ).toBeNull();
  });

  it("held = a spot on a shift whose day has passed, split by edition", () => {
    const out = buildMemberParticipation(
      participation({
        shifts: [
          { date: "2027-04-27", editionYear: 2027 },
          { date: "2027-04-29", editionYear: 2027 },
          { date: "2027-04-30", editionYear: 2027 }, // today — not yet
          { date: "2027-05-01", editionYear: 2027 }, // future
          { date: "2026-04-30", editionYear: 2026 },
          { date: "2025-04-30", editionYear: 2025 },
        ],
      }),
    )!;
    expect(out.shiftsHeldThisEdition).toBe(2);
    expect(out.shiftsHeldEarlier).toBe(2);
  });

  it("bio figures hidden from the viewer read as null, never as a number", () => {
    const out = buildMemberParticipation(
      participation({ bio: { attendedYears: [], skills: [] } }),
    )!;
    expect(out.burnsAttended).toBeNull();
    expect(out.skills).toBeNull();
    expect(
      buildMemberParticipation(participation({ bio: null }))!.burnsAttended,
    ).toBeNull();
  });

  it("no plans, no onboarding sent", () => {
    const out = buildMemberParticipation(
      participation({ logistics: null, onboarding: null }),
    )!;
    expect(out.buildStrike).toBeNull();
    expect(out.onboarding).toBeNull();
  });

  it("a draft pass list is shown only to someone who manages passes", () => {
    const draft = { thisEdition: DRAFT, earlierYears: [] };
    expect(
      buildMemberParticipation(participation({ passes: draft }))!.passes
        .thisEdition,
    ).toBe(DRAFT);
    // The member themself never sees a draft (`wapOwnPassLine`).
    expect(
      buildMemberParticipation(
        participation({
          passes: draft,
          viewerUserId: JABU,
          access: memberAccess,
        }),
      )!.passes.thisEdition,
    ).toBeNull();
    // Nor does a roster viewer who does not manage passes.
    expect(
      buildMemberParticipation(
        participation({
          passes: draft,
          viewerUserId: REN,
          access: grantedAccess,
        }),
      )!.passes.thisEdition,
    ).toBeNull();
  });

  it("earlier pass years are deduplicated, sorted, and never this year or later", () => {
    expect(
      buildMemberParticipation(
        participation({
          passes: { thisEdition: null, earlierYears: [2026, 2025, 2026, 2027] },
        }),
      )!.passes,
    ).toEqual({ thisEdition: null, earlierYears: [2025, 2026] });
  });
});

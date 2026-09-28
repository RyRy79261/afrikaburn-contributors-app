import { describe, it, expect } from "vitest";
import { GroupKind, MembershipRole } from "@quagga/types";

import {
  ALWAYS_PRIVATE_FIELDS,
  HARD_LOCKED_PRIVATE_FIELDS,
  SAFETY_VISIBLE_FIELDS,
} from "../privacy";
import { outstandingOfficers } from "../officers";
import {
  buildCampRoster,
  buildRosterCsv,
  canEditOwnLogistics,
  canExportCampRoster,
  canViewCampRoster,
  canViewMemberLogistics,
  deriveCampRosterStats,
  emptyMemberLogistics,
  emptyRosterFilter,
  formatLogisticsDate,
  isRosterFiltered,
  logisticsWindow,
  normalizeRosterSearch,
  parseRosterFilter,
  rosterBioStatus,
  rosterCsvFilename,
  rosterExportRow,
  rosterFilterQuery,
  ROSTER_EXPORT_COLUMNS,
  ROSTER_GROUP_KINDS,
  toCampRosterRow,
  validateMemberLogistics,
  type CampRosterRow,
  type RosterAccessContext,
  type RosterMemberInput,
} from "../camp-roster";

// Values from the real vocabularies (AGENTS.md "Verification": a fixture
// outside the enum is inert). Ids are fictional.
const THEME_CAMP = GroupKind.enum.theme_camp;
const ORG = GroupKind.enum.org;
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const JABU = "aaaaaaaa-0000-4000-8000-000000000003";
const KITCHEN = "c0000000-0000-4000-8000-000000000001";
const BUILD_CREW = "c0000000-0000-4000-8000-000000000002";
const OTHER_CAMP_ROLE = "c0000000-0000-4000-8000-0000000000ff";

/** AfrikaBurn 2027 · 26 April – 2 May 2027 (the seeded edition). */
const EDITION = { startDate: "2027-04-26", endDate: "2027-05-02" };

const lead: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: { structuralRole: LEAD, rolePermissions: [] },
};
const coLead: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: { structuralRole: ADMIN, rolePermissions: [] },
};
const plainMember: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: { structuralRole: MEMBER, rolePermissions: [{}] },
};
const grantedMember: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: {
    structuralRole: MEMBER,
    rolePermissions: [{}, { view_member_details: true }],
  },
};
const nonMember: RosterAccessContext = {
  groupKind: THEME_CAMP,
  viewerMembership: null,
};

function member(overrides: Partial<RosterMemberInput> = {}): RosterMemberInput {
  return {
    membershipId: "m-alice",
    userId: ALICE,
    displayName: "Alice Hatter",
    username: "Alice Hatter",
    structuralRole: MEMBER,
    projectRoles: [],
    bio: { completedAt: new Date("2027-01-10T00:00:00Z"), firstTime: false },
    logistics: null,
    ...overrides,
  };
}

const ROSTER: RosterMemberInput[] = [
  member({
    membershipId: "m-ren",
    userId: REN,
    displayName: "Ren Notfound",
    username: "Ren Notfound",
    structuralRole: MEMBER,
    projectRoles: [{ id: KITCHEN, name: "Kitchen" }],
    bio: { completedAt: null, firstTime: true },
  }),
  member({
    membershipId: "m-alice",
    userId: ALICE,
    structuralRole: LEAD,
  }),
  member({
    membershipId: "m-jabu",
    userId: JABU,
    displayName: "Jabu",
    username: "Jabu",
    structuralRole: ADMIN,
    projectRoles: [{ id: BUILD_CREW, name: "Build crew" }],
    bio: null,
  }),
  member({
    membershipId: "m-zoe",
    userId: "aaaaaaaa-0000-4000-8000-000000000004",
    displayName: "Zoë Stofpad",
    username: "Zoë Stofpad",
    structuralRole: MEMBER,
    bio: { completedAt: new Date("2027-02-01T00:00:00Z"), firstTime: true },
  }),
];

const ROLE_IDS = new Set([KITCHEN, BUILD_CREW]);

// --- Authorisation --------------------------------------------------------

describe("canViewCampRoster / canExportCampRoster", () => {
  it("allows lead and co-lead through the irrevocable backstop", () => {
    expect(canViewCampRoster(lead)).toBe(true);
    expect(canViewCampRoster(coLead)).toBe(true);
    expect(canExportCampRoster(lead)).toBe(true);
  });

  it("allows a member whose role grants view_member_details", () => {
    expect(canViewCampRoster(grantedMember)).toBe(true);
    expect(canExportCampRoster(grantedMember)).toBe(true);
  });

  it("refuses a member without the permission", () => {
    expect(canViewCampRoster(plainMember)).toBe(false);
    expect(canExportCampRoster(plainMember)).toBe(false);
  });

  it("refuses a non-member — including a lead of ANOTHER camp, whose membership here is null", () => {
    expect(canViewCampRoster(nonMember)).toBe(false);
    expect(canExportCampRoster(nonMember)).toBe(false);
  });

  it("refuses the org group whatever the viewer holds", () => {
    expect(canViewCampRoster({ ...lead, groupKind: ORG })).toBe(false);
  });

  it("covers every project kind and never the org", () => {
    expect(ROSTER_GROUP_KINDS).not.toContain(ORG);
    for (const kind of GroupKind.options.filter((k) => k !== ORG)) {
      expect(canViewCampRoster({ ...lead, groupKind: kind })).toBe(true);
    }
  });
});

describe("canEditOwnLogistics", () => {
  it("allows the member on their own membership", () => {
    expect(
      canEditOwnLogistics({
        viewerUserId: ALICE,
        membership: { userId: ALICE, groupKind: THEME_CAMP },
      }),
    ).toBe(true);
  });

  it("refuses anyone else's membership — a lead is a reader, not an editor", () => {
    expect(
      canEditOwnLogistics({
        viewerUserId: ALICE,
        membership: { userId: REN, groupKind: THEME_CAMP },
      }),
    ).toBe(false);
  });

  it("refuses a missing membership and the org group", () => {
    expect(canEditOwnLogistics({ viewerUserId: ALICE, membership: null })).toBe(
      false,
    );
    expect(
      canEditOwnLogistics({
        viewerUserId: ALICE,
        membership: { userId: ALICE, groupKind: ORG },
      }),
    ).toBe(false);
  });
});

describe("canViewMemberLogistics", () => {
  it("shows a member their own, even without the permission", () => {
    expect(
      canViewMemberLogistics({
        viewerUserId: REN,
        subjectUserId: REN,
        subjectInGroup: true,
        access: plainMember,
      }),
    ).toBe(true);
  });

  it("shows a roster viewer a member of the same group", () => {
    expect(
      canViewMemberLogistics({
        viewerUserId: ALICE,
        subjectUserId: REN,
        subjectInGroup: true,
        access: lead,
      }),
    ).toBe(true);
  });

  it("refuses a camp-mate without the permission", () => {
    expect(
      canViewMemberLogistics({
        viewerUserId: REN,
        subjectUserId: ALICE,
        subjectInGroup: true,
        access: plainMember,
      }),
    ).toBe(false);
  });

  it("refuses a subject outside the group, and the org group", () => {
    expect(
      canViewMemberLogistics({
        viewerUserId: ALICE,
        subjectUserId: REN,
        subjectInGroup: false,
        access: lead,
      }),
    ).toBe(false);
    expect(
      canViewMemberLogistics({
        viewerUserId: ALICE,
        subjectUserId: ALICE,
        subjectInGroup: true,
        access: { ...lead, groupKind: ORG },
      }),
    ).toBe(false);
  });
});

// --- Logistics validation -------------------------------------------------

describe("logisticsWindow", () => {
  it("opens 30 days before the start and closes 14 after the end", () => {
    expect(logisticsWindow(EDITION)).toEqual({
      earliest: "2027-03-27",
      latest: "2027-05-16",
    });
  });

  it("is null when the edition's dates are unreadable", () => {
    expect(logisticsWindow({ startDate: "soon", endDate: "2027-05-02" })).toBe(
      null,
    );
  });
});

describe("formatLogisticsDate", () => {
  it("reads as a person writes it", () => {
    expect(formatLogisticsDate("2027-04-26")).toBe("26 April 2027");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatLogisticsDate("nope")).toBe("nope");
  });
});

describe("validateMemberLogistics", () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    joiningBuild: true,
    joiningStrike: false,
    arrivalDate: "2027-04-20",
    departureDate: "2027-05-03",
    ...overrides,
  });

  it("accepts a plan inside the window", () => {
    expect(validateMemberLogistics(plan(), EDITION)).toEqual({
      ok: true,
      value: plan(),
    });
  });

  it("treats empty dates as not-known-yet", () => {
    const result = validateMemberLogistics(
      plan({ arrivalDate: "", departureDate: null }),
      EDITION,
    );
    expect(result).toEqual({
      ok: true,
      value: plan({ arrivalDate: null, departureDate: null }),
    });
  });

  it("accepts both window edges exactly", () => {
    expect(
      validateMemberLogistics(
        plan({ arrivalDate: "2027-03-27", departureDate: "2027-05-16" }),
        EDITION,
      ).ok,
    ).toBe(true);
  });

  it("refuses the day before the window opens", () => {
    const result = validateMemberLogistics(
      plan({ arrivalDate: "2027-03-26" }),
      EDITION,
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Your arrival date needs to be between 27 March 2027 and 16 May 2027.",
    });
  });

  it("refuses the day after the window closes", () => {
    const result = validateMemberLogistics(
      plan({ departureDate: "2027-05-17" }),
      EDITION,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/departure date/);
  });

  it("refuses last year's dates (the wrong-year typo)", () => {
    expect(
      validateMemberLogistics(plan({ arrivalDate: "2026-04-20" }), EDITION).ok,
    ).toBe(false);
  });

  it("accepts arriving and leaving on the same day", () => {
    expect(
      validateMemberLogistics(
        plan({ arrivalDate: "2027-04-28", departureDate: "2027-04-28" }),
        EDITION,
      ).ok,
    ).toBe(true);
  });

  it("refuses leaving before arriving", () => {
    expect(
      validateMemberLogistics(
        plan({ arrivalDate: "2027-04-29", departureDate: "2027-04-28" }),
        EDITION,
      ),
    ).toEqual({
      ok: false,
      error: "You can't leave before you arrive — check your dates.",
    });
  });

  it("refuses a date that does not exist, rather than rolling it over", () => {
    const result = validateMemberLogistics(
      plan({ arrivalDate: "2027-04-31" }),
      EDITION,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't a real date/);
  });

  it("refuses a malformed date string", () => {
    expect(
      validateMemberLogistics(plan({ arrivalDate: "20/04/2027" }), EDITION).ok,
    ).toBe(false);
  });

  it("refuses a body naming whose record it is (strict shape)", () => {
    expect(
      validateMemberLogistics(plan({ membershipId: "m-ren" }), EDITION),
    ).toEqual({ ok: false, error: "That didn't look like a travel plan." });
    expect(validateMemberLogistics(plan({ userId: REN }), EDITION).ok).toBe(
      false,
    );
  });

  it("refuses a non-boolean build flag", () => {
    expect(
      validateMemberLogistics(plan({ joiningBuild: "yes" }), EDITION).ok,
    ).toBe(false);
  });

  it("refuses when the edition has no readable dates", () => {
    expect(
      validateMemberLogistics(plan(), { startDate: "", endDate: "" }),
    ).toEqual({ ok: false, error: "This edition's dates aren't set yet." });
  });

  it("empty logistics are a valid save", () => {
    expect(validateMemberLogistics(emptyMemberLogistics(), EDITION)).toEqual({
      ok: true,
      value: emptyMemberLogistics(),
    });
  });
});

// --- Rows, filter, roster -------------------------------------------------

describe("rosterBioStatus", () => {
  it("distinguishes none, incomplete and complete", () => {
    expect(rosterBioStatus(null)).toBe("none");
    expect(rosterBioStatus({ completedAt: null })).toBe("incomplete");
    expect(rosterBioStatus({ completedAt: new Date() })).toBe("complete");
  });
});

describe("toCampRosterRow", () => {
  it("copies named fields only — an over-selected loader row loses the extra", () => {
    const leaky = {
      ...member({
        logistics: {
          joiningBuild: true,
          joiningStrike: true,
          arrivalDate: "2027-04-20",
          departureDate: null,
        },
      }),
      phone: "+27820000000",
      medicalNotes: "asthma",
    } as RosterMemberInput;
    const row = toCampRosterRow(leaky);
    expect(Object.keys(row).sort()).toEqual(
      [
        "bioStatus",
        "displayName",
        "logistics",
        "membershipId",
        "projectRoles",
        "structuralRole",
        "userId",
        "username",
      ].sort(),
    );
    expect(JSON.stringify(row)).not.toMatch(/27820000000|asthma/);
  });
});

describe("normalizeRosterSearch", () => {
  it("folds case, accents and whitespace", () => {
    expect(normalizeRosterSearch("  Zoë   STOFPAD ")).toBe("zoe stofpad");
  });
});

describe("parseRosterFilter", () => {
  it("reads nothing from empty params", () => {
    expect(parseRosterFilter({}, ROLE_IDS)).toEqual(emptyRosterFilter());
    expect(isRosterFiltered(emptyRosterFilter())).toBe(false);
  });

  it("reads search, structural role and bio", () => {
    const filter = parseRosterFilter(
      { q: " Ren ", role: "admin", bio: "incomplete" },
      ROLE_IDS,
    );
    expect(filter).toEqual({
      q: "ren",
      role: { kind: "structural", role: "admin" },
      bio: "incomplete",
      status: "current",
    });
    expect(isRosterFiltered(filter)).toBe(true);
  });

  it("reads this camp's project role", () => {
    expect(
      parseRosterFilter({ role: `role:${KITCHEN}` }, ROLE_IDS).role,
    ).toEqual({ kind: "project", roleId: KITCHEN });
  });

  it("ignores another camp's role id, an org rank and unknown values", () => {
    expect(
      parseRosterFilter({ role: `role:${OTHER_CAMP_ROLE}` }, ROLE_IDS).role,
    ).toBeNull();
    expect(parseRosterFilter({ role: "god" }, ROLE_IDS).role).toBeNull();
    expect(parseRosterFilter({ bio: "maybe" }, ROLE_IDS).bio).toBeNull();
  });

  it("takes the first of a repeated param and caps the search length", () => {
    const filter = parseRosterFilter(
      { q: ["a".repeat(500), "b"], bio: ["complete", "incomplete"] },
      ROLE_IDS,
    );
    expect(filter.q).toHaveLength(100);
    expect(filter.bio).toBe("complete");
  });

  it("round-trips through the query string", () => {
    const filter = parseRosterFilter(
      { q: "hatter", role: `role:${BUILD_CREW}`, bio: "complete" },
      ROLE_IDS,
    );
    const query = rosterFilterQuery(filter);
    const again = parseRosterFilter(
      Object.fromEntries(new URLSearchParams(query)),
      ROLE_IDS,
    );
    expect(again).toEqual(filter);
    expect(rosterFilterQuery(emptyRosterFilter())).toBe("");
  });

  // CDB-036: the former-members list is picked by `status`, and only by the
  // one value — anything else is the camp itself (fail-soft, like the rest).
  it("reads status=former, and nothing else, as the former-members list", () => {
    expect(parseRosterFilter({ status: "former" }, ROLE_IDS).status).toBe(
      "former",
    );
    for (const status of ["current", "archived", "FORMER", ""]) {
      expect(parseRosterFilter({ status }, ROLE_IDS).status).toBe("current");
    }
  });

  it("carries status=former through the query string (so the export matches)", () => {
    const filter = parseRosterFilter({ status: "former", q: "ren" }, ROLE_IDS);
    const query = rosterFilterQuery(filter);
    expect(query).toContain("status=former");
    expect(
      parseRosterFilter(
        Object.fromEntries(new URLSearchParams(query)),
        ROLE_IDS,
      ),
    ).toEqual(filter);
    // The default list adds nothing to the URL.
    expect(rosterFilterQuery(parseRosterFilter({ q: "ren" }, ROLE_IDS))).toBe(
      "q=ren",
    );
  });

  it("does not count the list choice as a narrowing filter", () => {
    expect(
      isRosterFiltered(parseRosterFilter({ status: "former" }, ROLE_IDS)),
    ).toBe(false);
  });
});

describe("buildCampRoster", () => {
  const names = (view: { rows: CampRosterRow[] } | null) =>
    view?.rows.map((r) => r.displayName);

  it("refuses a viewer who may not see it — before looking at any member", () => {
    for (const access of [plainMember, nonMember]) {
      expect(
        buildCampRoster({
          access,
          members: ROSTER,
          filter: emptyRosterFilter(),
        }),
      ).toBeNull();
    }
  });

  it("orders by seniority then name and reports the unfiltered total", () => {
    const view = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: emptyRosterFilter(),
    });
    expect(names(view)).toEqual([
      "Alice Hatter",
      "Jabu",
      "Ren Notfound",
      "Zoë Stofpad",
    ]);
    expect(view?.total).toBe(4);
  });

  it("searches the name without caring about accents or case", () => {
    const view = buildCampRoster({
      access: grantedMember,
      members: ROSTER,
      filter: parseRosterFilter({ q: "zoe" }, ROLE_IDS),
    });
    expect(names(view)).toEqual(["Zoë Stofpad"]);
    expect(view?.total).toBe(4);
  });

  it("searches the burner name too", () => {
    const view = buildCampRoster({
      access: lead,
      members: [member({ displayName: "Departed Burner", username: "ghost" })],
      filter: parseRosterFilter({ q: "ghost" }, ROLE_IDS),
    });
    expect(view?.rows).toHaveLength(1);
  });

  it("filters by structural role", () => {
    const view = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: parseRosterFilter({ role: "member" }, ROLE_IDS),
    });
    expect(names(view)).toEqual(["Ren Notfound", "Zoë Stofpad"]);
  });

  it("filters by project role", () => {
    const view = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: parseRosterFilter({ role: `role:${KITCHEN}` }, ROLE_IDS),
    });
    expect(names(view)).toEqual(["Ren Notfound"]);
  });

  it("filters by bio completion — incomplete includes no bio at all", () => {
    const complete = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: parseRosterFilter({ bio: "complete" }, ROLE_IDS),
    });
    expect(names(complete)).toEqual(["Alice Hatter", "Zoë Stofpad"]);
    const incomplete = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: parseRosterFilter({ bio: "incomplete" }, ROLE_IDS),
    });
    expect(names(incomplete)).toEqual(["Jabu", "Ren Notfound"]);
  });

  it("combines filters", () => {
    const view = buildCampRoster({
      access: lead,
      members: ROSTER,
      filter: parseRosterFilter(
        { role: "member", bio: "incomplete", q: "ren" },
        ROLE_IDS,
      ),
    });
    expect(names(view)).toEqual(["Ren Notfound"]);
  });
});

// --- Stats ----------------------------------------------------------------

describe("deriveCampRosterStats", () => {
  const inFlight = outstandingOfficers({
    isRegisteredOrInFlight: true,
    triggers: {
      soundLevel: 0,
      hasGenerators: false,
      hasOpenFlame: false,
      hasFuelStorage: false,
    },
    assignedKeys: [],
  });

  it("counts new, returning, unknown and complete", () => {
    const stats = deriveCampRosterStats(ROSTER, null);
    expect(stats).toEqual({
      total: 4,
      newcomers: 2,
      returning: 1,
      unknown: 1,
      biosComplete: 2,
      joiningBuild: 0,
      joiningStrike: 0,
      former: 0,
      officers: { applies: false, filled: 0, required: 0 },
    });
  });

  it("reports the former-member count it is given, as a number only", () => {
    // The members passed are the CURRENT camp; former members are counted by
    // the loader and never contribute to new/returning/bios.
    const stats = deriveCampRosterStats(ROSTER, null, 3);
    expect(stats.former).toBe(3);
    expect(stats.total).toBe(4);
  });

  it("counts build and strike from members' own logistics", () => {
    const withPlans = ROSTER.map((m, i) => ({
      ...m,
      logistics:
        i === 3
          ? null
          : {
              joiningBuild: i !== 2,
              joiningStrike: i === 0,
              arrivalDate: null,
              departureDate: null,
            },
    }));
    const stats = deriveCampRosterStats(withPlans, null);
    expect(stats.joiningBuild).toBe(2);
    expect(stats.joiningStrike).toBe(1);
  });

  it("moves when the fixture moves (a returning member becomes new)", () => {
    const flipped = ROSTER.map((m) =>
      m.userId === ALICE
        ? { ...m, bio: { completedAt: null, firstTime: true } }
        : m,
    );
    const stats = deriveCampRosterStats(flipped, null);
    expect(stats.newcomers).toBe(3);
    expect(stats.returning).toBe(0);
    expect(stats.biosComplete).toBe(1);
  });

  it("reports officer slots from the officer status when requirements apply", () => {
    expect(inFlight.applies).toBe(true);
    expect(inFlight.requiredCount).toBeGreaterThan(0);
    const stats = deriveCampRosterStats(ROSTER, inFlight);
    expect(stats.officers).toEqual({
      applies: true,
      filled: inFlight.assignedCount,
      required: inFlight.requiredCount,
    });
  });

  it("reports no officer requirement for a camp that has not registered", () => {
    const free = outstandingOfficers({
      isRegisteredOrInFlight: false,
      triggers: {
        soundLevel: 0,
        hasGenerators: false,
        hasOpenFlame: false,
        hasFuelStorage: false,
      },
      assignedKeys: [],
    });
    expect(deriveCampRosterStats([], free)).toEqual({
      total: 0,
      newcomers: 0,
      returning: 0,
      unknown: 0,
      biosComplete: 0,
      joiningBuild: 0,
      joiningStrike: 0,
      former: 0,
      officers: { applies: false, filled: 0, required: 0 },
    });
  });

  it("is numbers only — no per-person breakdown can ride on it", () => {
    const stats = deriveCampRosterStats(ROSTER, inFlight);
    const leaves = JSON.stringify(stats);
    for (const m of ROSTER) {
      expect(leaves).not.toContain(m.userId);
      expect(leaves).not.toContain(m.displayName);
    }
    const flat = [
      stats.total,
      stats.newcomers,
      stats.returning,
      stats.unknown,
      stats.biosComplete,
      stats.joiningBuild,
      stats.joiningStrike,
      stats.officers.filled,
      stats.officers.required,
    ];
    expect(flat.every((n) => typeof n === "number")).toBe(true);
  });
});

// --- Export ---------------------------------------------------------------

describe("roster export", () => {
  const row = (overrides: Partial<RosterMemberInput> = {}) =>
    toCampRosterRow(member(overrides));

  it("cannot carry a hard-locked or medical field — the shape has no slot", () => {
    const keys = ROSTER_EXPORT_COLUMNS.map((c) => c.key as string);
    const forbidden = [
      ...ALWAYS_PRIVATE_FIELDS,
      ...HARD_LOCKED_PRIVATE_FIELDS,
      ...SAFETY_VISIBLE_FIELDS,
      "medicalNotes",
      "idNumber",
      "email",
      "contactEmail",
    ].map((k) => k.toLowerCase());
    for (const key of keys) {
      expect(forbidden).not.toContain(key.toLowerCase());
      expect(key.toLowerCase()).not.toMatch(
        /phone|medical|passport|said|idnumber|contact|email/,
      );
    }
    // And the projection returns exactly those keys whatever it is handed.
    const leaky = {
      ...row(),
      phone: "+27820000000",
      medicalNotes: "asthma",
      onsiteContactPhone: "+27830000000",
      idNumber: "8001015009087",
    } as CampRosterRow;
    expect(Object.keys(rosterExportRow(leaky)).sort()).toEqual(
      [...keys].sort(),
    );
    const csv = buildRosterCsv([leaky]);
    expect(csv).not.toMatch(/27820000000|27830000000|asthma|8001015009087/);
  });

  it("writes the headers and a row with logistics", () => {
    const csv = buildRosterCsv([
      row({
        structuralRole: LEAD,
        projectRoles: [{ id: KITCHEN, name: "Kitchen" }],
        logistics: {
          joiningBuild: true,
          joiningStrike: false,
          arrivalDate: "2027-04-20",
          departureDate: "2027-05-03",
        },
      }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Name,Burner name,Roles,Arrival,Departure,Joining build,Joining strike",
    );
    expect(lines[1]).toBe(
      "Alice Hatter,Alice Hatter,Lead; Kitchen,2027-04-20,2027-05-03,Yes,No",
    );
    expect(lines[2]).toBe("");
  });

  it("leaves logistics blank (not No) for a member who has not said", () => {
    const out = rosterExportRow(row({ logistics: null }));
    expect(out.build).toBeNull();
    expect(out.strike).toBeNull();
    expect(buildRosterCsv([row({ logistics: null })])).toContain(
      "Alice Hatter,Alice Hatter,Member,,,,",
    );
  });

  it("writes a departed account's placeholder with a blank burner name", () => {
    expect(
      rosterExportRow(row({ displayName: "Departed Burner", username: null })),
    ).toMatchObject({ name: "Departed Burner", burnerName: null });
  });

  it.each([
    ['=HYPERLINK("http://x")', "'=HYPERLINK"],
    ["+27 SUM", "'+27 SUM"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTabbed", "'\tTabbed"],
    ["\rReturn", "'\rReturn"],
  ])("neutralises a formula-looking name %j", (name, expected) => {
    const csv = buildRosterCsv([row({ displayName: name, username: name })]);
    const dataLine = csv.slice(1).split("\r\n").slice(1).join("\r\n");
    expect(dataLine).toContain(expected);
    // No cell of the data line starts with a live formula character.
    expect(dataLine).not.toMatch(/(^|,)"?[=+\-@]/);
  });

  it("neutralises a formula in a project role name", () => {
    const csv = buildRosterCsv([
      row({ projectRoles: [{ id: KITCHEN, name: "=1+1" }] }),
    ]);
    // The roles cell starts with the structural label, so the injected role is
    // mid-cell; check the cell as a whole is plain text.
    expect(csv).toContain("Member; =1+1");
  });

  it("names the file after the camp, the edition and the day, safely", () => {
    const today = new Date("2027-03-01T10:00:00Z");
    expect(rosterCsvFilename("mad-hatters", 2027, today)).toBe(
      "mad-hatters-2027-roster-2027-03-01.csv",
    );
    expect(rosterCsvFilename('bad"; name', 2027, today)).toBe(
      "badname-2027-roster-2027-03-01.csv",
    );
    expect(rosterCsvFilename("???", 2027, today)).toBe(
      "camp-2027-roster-2027-03-01.csv",
    );
  });
});

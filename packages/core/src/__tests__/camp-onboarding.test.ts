import { describe, it, expect } from "vitest";
import type { ProjectAudience, Questionnaire } from "@quagga/types";
import {
  buildOnboardingPreset,
  canAuthorOnboarding,
  carryForwardOnboarding,
  classifyCampTenure,
  defaultOnboardingAudience,
  describeOnboardingAudience,
  isOnboardingDefinition,
  onboardingReleasedNotification,
  parseOnboardingNamesFilter,
  summarizeOnboarding,
  tallyOnboardingCompletion,
  validateOnboardingDefinition,
} from "../camp-onboarding";
import { resolveAudience, type AudienceContext } from "../audience";
import type { PermissionMembership } from "../project-permissions";

// Camp onboarding (epic #54). The rules Ryan set, each pinned here:
//   - a PRESET on camp questionnaires (info blocks, a video LINK, tick boxes);
//   - NOT blocking by default; leads and co-leads ON the audience by default;
//   - "new" = new to THIS camp, never to AfrikaBurn;
//   - totals first (ONBOARD-020); last edition's carried as a DRAFT
//     (ONBOARD-022) with the due date cleared.

const GROUP = "g-camp";

const EDITIONS = [
  { year: 2025, endDate: "2025-05-05" },
  { year: 2026, endDate: "2026-05-04" },
  { year: 2027, endDate: "2027-05-02" },
];

describe("classifyCampTenure — new vs returning to THIS camp", () => {
  const target = { year: 2027 };

  it("is returning when the membership began before the last earlier burn ended", () => {
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2026-03-01T10:00:00Z"),
          logisticsEditionYears: [],
        },
        target,
        EDITIONS,
      ),
    ).toBe("returning");
  });

  it("counts the last day of the earlier burn itself", () => {
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2026-05-04T20:00:00Z"),
          logisticsEditionYears: [],
        },
        target,
        EDITIONS,
      ),
    ).toBe("returning");
  });

  it("is new when they joined after the last earlier burn ended", () => {
    // A ten-burn veteran who joined this camp in August is new TO IT.
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2026-08-15T10:00:00Z"),
          logisticsEditionYears: [],
        },
        target,
        EDITIONS,
      ),
    ).toBe("new");
  });

  it("is returning when they hold logistics with the camp for an earlier edition", () => {
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2026-08-15T10:00:00Z"),
          logisticsEditionYears: [2026],
        },
        target,
        EDITIONS,
      ),
    ).toBe("returning");
  });

  it("does not count logistics for THIS edition as history", () => {
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2026-08-15T10:00:00Z"),
          logisticsEditionYears: [2027],
        },
        target,
        EDITIONS,
      ),
    ).toBe("new");
  });

  it("calls everyone new when no earlier edition is on record", () => {
    expect(
      classifyCampTenure(
        {
          membershipCreatedAt: new Date("2020-01-01T00:00:00Z"),
          logisticsEditionYears: [],
        },
        target,
        [{ year: 2027, endDate: "2027-05-02" }],
      ),
    ).toBe("new");
  });
});

describe("the onboarding preset", () => {
  const preset = buildOnboardingPreset();

  it("is marked as onboarding and passes its own validation", () => {
    expect(isOnboardingDefinition(preset)).toBe(true);
    expect(validateOnboardingDefinition(preset).ok).toBe(true);
  });

  it("has the design's sections, one step each, acknowledgements last", () => {
    expect(preset.pages.map((p) => p.id)).toEqual([
      "welcome",
      "culture",
      "rules",
      "provides",
      "build_strike",
      "acknowledgements",
    ]);
    const s = summarizeOnboarding(preset);
    expect(s.sections).toBe(6);
    expect(s.acknowledgements).toBeGreaterThan(0);
  });

  it("never mentions payment (ONBOARD-013 is out under the money law)", () => {
    expect(JSON.stringify(preset)).not.toMatch(
      /\b(pay|payment|fee|fees|dues|money|deposit|ZAR)\b/i,
    );
  });
});

describe("validateOnboardingDefinition", () => {
  const withBlock = (block: unknown): unknown => ({
    version: "1",
    preset: "onboarding",
    pages: [{ id: "p1", kind: "questions", title: "One", questions: [block] }],
  });

  it("refuses a definition not built from the preset", () => {
    const { preset: _p, ...plain } = buildOnboardingPreset();
    expect(validateOnboardingDefinition(plain).ok).toBe(false);
  });

  it("refuses question kinds that ask for answers — onboarding tells, it doesn't survey", () => {
    const r = validateOnboardingDefinition(
      withBlock({ id: "q", kind: "short_text", prompt: "Diet?" }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts info, video link and acknowledgement blocks", () => {
    for (const block of [
      { id: "i", kind: "info_block", body: "Hello" },
      {
        id: "v",
        kind: "video_link",
        url: "https://www.youtube.com/watch?v=x",
        title: "Tour",
      },
      { id: "a", kind: "acknowledgement", prompt: "I will." },
    ]) {
      expect(validateOnboardingDefinition(withBlock(block)).ok).toBe(true);
    }
  });

  it("refuses a video link that isn't https (no javascript:, no http:)", () => {
    for (const url of ["javascript:alert(1)", "http://example.com/v"]) {
      expect(
        validateOnboardingDefinition(
          withBlock({ id: "v", kind: "video_link", url, title: "T" }),
        ).ok,
      ).toBe(false);
    }
  });

  it("refuses branching and intro pages", () => {
    const branching = {
      version: "1",
      preset: "onboarding",
      pages: [
        {
          id: "p1",
          kind: "questions",
          title: "One",
          next: "p1",
          questions: [{ id: "i", kind: "info_block", body: "x" }],
        },
      ],
    };
    expect(validateOnboardingDefinition(branching).ok).toBe(false);
    const intro = {
      version: "1",
      preset: "onboarding",
      pages: [{ id: "p1", kind: "intro", heading: "Hi", body: "x" }],
    };
    expect(validateOnboardingDefinition(intro).ok).toBe(false);
  });

  it("refuses more sections than a phone should carry", () => {
    const pages = Array.from({ length: 13 }, (_, i) => ({
      id: `p${i}`,
      kind: "questions",
      title: `S${i}`,
      questions: [{ id: `i${i}`, kind: "info_block", body: "x" }],
    }));
    expect(
      validateOnboardingDefinition({ version: "1", preset: "onboarding", pages })
        .ok,
    ).toBe(false);
  });
});

describe("defaultOnboardingAudience + resolution", () => {
  // Lead, co-lead, two members; one member new, one returning.
  const ctx: AudienceContext = {
    editionId: "e",
    orgGroupId: "",
    groups: [],
    registrations: [],
    bios: [],
    roleAssignments: [],
    memberships: [
      { membershipId: "m1", userId: "lead", groupId: GROUP, role: "lead", tenure: "returning" },
      { membershipId: "m2", userId: "colead", groupId: GROUP, role: "admin", tenure: "new" },
      { membershipId: "m3", userId: "newbie", groupId: GROUP, role: "member", tenure: "new" },
      { membershipId: "m4", userId: "vet", groupId: GROUP, role: "member", tenure: "returning" },
      { membershipId: "x", userId: "elsewhere", groupId: "other", role: "member", tenure: "new" },
    ],
  };

  it("reaches everyone in the camp by default, leads and co-leads included", () => {
    expect(resolveAudience(defaultOnboardingAudience(GROUP), ctx)).toEqual([
      "colead",
      "lead",
      "newbie",
      "vet",
    ]);
  });

  it("leaves leads and co-leads out when the lead switches them off", () => {
    const aud: ProjectAudience = {
      ...defaultOnboardingAudience(GROUP),
      structuralRoles: ["member"],
    };
    expect(resolveAudience(aud, ctx)).toEqual(["newbie", "vet"]);
  });

  it("narrows to new to the camp only", () => {
    const aud: ProjectAudience = {
      ...defaultOnboardingAudience(GROUP),
      tenure: ["new"],
    };
    expect(resolveAudience(aud, ctx)).toEqual(["colead", "newbie"]);
  });

  it("describes the default audience in generic words", () => {
    expect(
      describeOnboardingAudience(defaultOnboardingAudience(GROUP), new Map()),
    ).toBe("new and returning to the camp · Everyone");
    expect(
      describeOnboardingAudience(
        { ...defaultOnboardingAudience(GROUP), structuralRoles: ["member"] },
        new Map(),
      ),
    ).toBe("new and returning to the camp · Member");
  });
});

describe("tallyOnboardingCompletion — totals first", () => {
  it("splits complete by new and returning, and never counts a waived row", () => {
    const t = tallyOnboardingCompletion([
      { status: "completed", tenure: "new" },
      { status: "pending", tenure: "new" },
      { status: "completed", tenure: "returning" },
      { status: "completed", tenure: "returning" },
      { status: "expired", tenure: "returning" },
      { status: "waived", tenure: "new" },
    ]);
    expect(t).toEqual({
      total: 5,
      complete: 3,
      percent: 60,
      outstanding: 2,
      newTotal: 2,
      newComplete: 1,
      returningTotal: 3,
      returningComplete: 2,
    });
  });

  it("reads 0% rather than dividing by zero", () => {
    expect(tallyOnboardingCompletion([]).percent).toBe(0);
  });
});

describe("parseOnboardingNamesFilter", () => {
  it("accepts only the three filters; anything else means totals only", () => {
    expect(parseOnboardingNamesFilter("all")).toBe("all");
    expect(parseOnboardingNamesFilter(["incomplete"])).toBe("incomplete");
    expect(parseOnboardingNamesFilter(undefined)).toBeNull();
    expect(parseOnboardingNamesFilter("everyone")).toBeNull();
  });
});

describe("carryForwardOnboarding (ONBOARD-022)", () => {
  const source = {
    title: "Welcome to the camp",
    description: null,
    definition: buildOnboardingPreset(),
    audience: {
      ...defaultOnboardingAudience("g-old"),
      structuralRoles: ["member" as const],
    },
    blocking: true,
  };

  it("keeps the content, audience and blocking choice, clears the due date", () => {
    const draft = carryForwardOnboarding(source, GROUP);
    expect(draft.definition.pages).toEqual(source.definition.pages);
    expect(draft.blocking).toBe(true);
    expect(draft.dueAt).toBeNull();
    expect(draft.audience.structuralRoles).toEqual(["member"]);
  });

  it("re-anchors the audience on the camp it is carried into", () => {
    expect(carryForwardOnboarding(source, GROUP).audience.groupId).toBe(GROUP);
  });

  it("keeps the preset mark even if the source somehow lost it", () => {
    const { preset: _p, ...plain } = buildOnboardingPreset();
    const draft = carryForwardOnboarding(
      { ...source, definition: plain as Questionnaire },
      GROUP,
    );
    expect(draft.definition.preset).toBe("onboarding");
  });
});

describe("canAuthorOnboarding — enforced server-side by every action", () => {
  const BASELINE = "role-baseline";
  const lead: PermissionMembership = { structuralRole: "lead", rolePermissions: [] };
  const colead: PermissionMembership = { structuralRole: "admin", rolePermissions: [] };
  const plain: PermissionMembership = { structuralRole: "member", rolePermissions: [] };
  const scoped: PermissionMembership = {
    structuralRole: "member",
    rolePermissions: [
      { manage_questionnaires: { audienceRoles: [BASELINE], mayBlock: false } },
    ],
  };
  const aud = defaultOnboardingAudience(GROUP);

  it("lets a lead and a co-lead author, blocking or not", () => {
    expect(canAuthorOnboarding(lead, "theme_camp", aud, true, BASELINE)).toBe(true);
    expect(canAuthorOnboarding(colead, "theme_camp", aud, false, BASELINE)).toBe(true);
  });

  it("refuses a plain member and a non-member", () => {
    expect(canAuthorOnboarding(plain, "theme_camp", aud, false, BASELINE)).toBe(false);
    expect(canAuthorOnboarding(null, "theme_camp", aud, false, BASELINE)).toBe(false);
  });

  it("holds a manage_questionnaires holder to their scope — no blocking without may_block", () => {
    expect(canAuthorOnboarding(scoped, "theme_camp", aud, false, BASELINE)).toBe(true);
    expect(canAuthorOnboarding(scoped, "theme_camp", aud, true, BASELINE)).toBe(false);
  });

  it("is a camp's feature — never for an artwork, a vehicle or the org", () => {
    for (const kind of ["artwork", "mutant_vehicle", "org"]) {
      expect(canAuthorOnboarding(lead, kind, aud, false, BASELINE)).toBe(false);
    }
  });
});

describe("onboardingReleasedNotification", () => {
  it("says onboarding and names the camp; a blocking one says it blocks the APP, never registration", () => {
    const optional = onboardingReleasedNotification({
      title: "Welcome",
      blocking: false,
      activationId: "a1",
      campName: "The camp",
    });
    expect(optional.title).toBe("Onboarding from The camp: Welcome");
    expect(optional.link).toBe("/questionnaires/a1");
    const blocking = onboardingReleasedNotification({
      title: "Welcome",
      blocking: true,
      activationId: "a1",
      campName: "The camp",
    });
    expect(blocking.title).toMatch(/blocks the app/);
    expect(blocking.title).not.toMatch(/registration/i);
  });
});

import { describe, it, expect } from "vitest";
import { MembershipRole, formForSection } from "@quagga/types";

import {
  buildCarryForwardPatch,
  diffRegistrations,
  changedFields,
  summarizeChanges,
  CARRIED_FIELDS,
  CARRY_FORWARD_FIELDS,
  NON_CARRIED_FIELDS,
  labelForField,
  sectionForField,
  canViewCampRegistration,
  isValidCarryForwardSource,
  pastSubmittedRegistrations,
  selectComparisonPrior,
  wasSubmitted,
  type CarryForwardFields,
  type PriorRegistrationRef,
} from "../registration-carry-forward";

/** A fully-answered prior registration. */
function priorRegistration(
  overrides: Partial<CarryForwardFields> = {},
): CarryForwardFields {
  return {
    s1ContactEmail: "leads@madhatters.example",
    s1AltContactName: "Thandi",
    s1AltContactPhone: "+27821234567",
    s1AltContactEmail: "thandi@madhatters.example",
    s2LntPlan:
      "Sweep grid daily, MOOP bins at every exit, final sweep Tuesday.",
    s2LntLeadName: "Sipho",
    s2LntLeadPhone: "+27829876543",
    s2LntLeadEmail: "sipho@madhatters.example",
    s3ParticipationPlan: "Tea service at dawn, hat-making workshop at four.",
    s3OperatingHours: ["06:00–10:00", "16:00–20:00"],
    s3ScheduleDetail: "Workshops on the Thursday and Saturday only.",
    s3GiftingFood: true,
    s4ExpectedPopulation: 42,
    s4FirstArrivalDate: "2026-04-20",
    s4WorkAccessPasses: 6,
    s4AreaDimensions: "30m x 20m",
    s4LayoutUploadUrls: ["https://blob.example/layout-2026.pdf"],
    s5AmplifiedMusic: "Small rig — background only",
    s5SoundPlan: "Speakers face inward, off by 02:00.",
    s5PlacementFirstChoice: "Mid-city (3ish–9ish roads)",
    s5PlacementSecondChoice: "Outer roads (back of the city)",
    s5NeighbourRequest: "Next to Dusty Prototype please.",
    s5FamilyFriendly: "Yes",
    s6SuppliersNote: "Ice from the depot, water from the AB supplier.",
    s6PaidPerformers: false,
    s6FeeStructure: "R850 covers infrastructure and shared meals.",
    s6ExpectedBudgetZar: 48_000,
    s6PlugAndPlayAck: true,
    grantsInterest: true,
    ...overrides,
  };
}

describe("buildCarryForwardPatch", () => {
  it("carries the Form 1 answers that are still true a year later", () => {
    const patch = buildCarryForwardPatch(priorRegistration());

    expect(patch.s2LntPlan).toBe(
      "Sweep grid daily, MOOP bins at every exit, final sweep Tuesday.",
    );
    expect(patch.s3ParticipationPlan).toBe(
      "Tea service at dawn, hat-making workshop at four.",
    );
    expect(patch.s1ContactEmail).toBe("leads@madhatters.example");
    expect(patch.s6FeeStructure).toBe(
      "R850 covers infrastructure and shared meals.",
    );
  });

  it("starts every Form 2 answer empty — placement, layout, size and sound are new each year", () => {
    const patch = buildCarryForwardPatch(priorRegistration());

    // Placement is decided fresh, and placement ZONES are configured per edition
    // year — a carried 2026 zone may not exist in 2027's list at all.
    expect(patch).not.toHaveProperty("s5PlacementFirstChoice");
    expect(patch).not.toHaveProperty("s5PlacementSecondChoice");
    expect(patch).not.toHaveProperty("s5NeighbourRequest");
    // Last year's diagram describes last year's camp on last year's erf.
    expect(patch).not.toHaveProperty("s4LayoutUploadUrls");
    expect(patch).not.toHaveProperty("s4AreaDimensions");
    // Nobody knows their size or arrival date in September.
    expect(patch).not.toHaveProperty("s4ExpectedPopulation");
    expect(patch).not.toHaveProperty("s4FirstArrivalDate");
    expect(patch).not.toHaveProperty("s4WorkAccessPasses");
    // Sound is a Form 2 answer too.
    expect(patch).not.toHaveProperty("s5AmplifiedMusic");
    expect(patch).not.toHaveProperty("s5SoundPlan");
    expect(patch).not.toHaveProperty("s5FamilyFriendly");
  });

  it("never carries an acknowledgement or grant interest, though both are Form 1", () => {
    const patch = buildCarryForwardPatch(priorRegistration());
    // Copying a tick manufactures consent that was never given.
    expect(patch).not.toHaveProperty("s6PlugAndPlayAck");
    // Tied to that edition's grant round.
    expect(patch).not.toHaveProperty("grantsInterest");
  });

  it("excludes every Form 2 field structurally, not by a hand-written list", () => {
    // A field added to a Form 2 section tomorrow must be excluded automatically
    // — the failure mode of a stale hand-written list is last year's placement
    // silently reappearing.
    for (const field of CARRY_FORWARD_FIELDS) {
      if (formForSection(sectionForField(field)) === 2) {
        expect(
          NON_CARRIED_FIELDS,
          `${field} is a Form 2 field and must not carry`,
        ).toContain(field);
      }
    }
  });

  it("skips fields the prior registration left blank", () => {
    const patch = buildCarryForwardPatch(
      priorRegistration({
        s5NeighbourRequest: null,
        s3ScheduleDetail: "   ",
        s3OperatingHours: [],
      }),
    );

    expect(patch).not.toHaveProperty("s5NeighbourRequest");
    expect(patch).not.toHaveProperty("s3ScheduleDetail");
    expect(patch).not.toHaveProperty("s3OperatingHours");
  });

  it("returns nothing for an empty prior registration", () => {
    expect(buildCarryForwardPatch({})).toEqual({});
  });

  it("agrees with the exported field lists", () => {
    const patch = buildCarryForwardPatch(priorRegistration());
    expect(Object.keys(patch).sort()).toEqual([...CARRIED_FIELDS].sort());
    expect(CARRIED_FIELDS).toHaveLength(
      CARRY_FORWARD_FIELDS.length - NON_CARRIED_FIELDS.length,
    );
  });
});

describe("diffRegistrations", () => {
  it("reports an unchanged registration as entirely unchanged", () => {
    const prior = priorRegistration();
    const changes = changedFields(prior, prior);
    expect(changes).toEqual([]);
  });

  it("ignores whitespace-only edits", () => {
    const prior = priorRegistration();
    const current = priorRegistration({
      s2LntPlan:
        "  Sweep grid daily, MOOP bins at every exit, final sweep Tuesday.  ",
    });
    expect(changedFields(prior, current)).toEqual([]);
  });

  it("ignores array reordering but catches array membership changes", () => {
    const prior = priorRegistration();

    const reordered = priorRegistration({
      s3OperatingHours: ["16:00–20:00", "06:00–10:00"],
    });
    expect(changedFields(prior, reordered)).toEqual([]);

    const different = priorRegistration({
      s3OperatingHours: ["06:00–10:00"],
    });
    const moved = changedFields(prior, different);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.field).toBe("s3OperatingHours");
    expect(moved[0]?.kind).toBe("changed");
  });

  it("distinguishes changed, added and cleared", () => {
    const prior = priorRegistration({ s5NeighbourRequest: null });
    const current = priorRegistration({
      // changed
      s4ExpectedPopulation: 60,
      // added — blank last year, answered now
      s5NeighbourRequest: "Anywhere near water please.",
      // cleared — answered last year, blank now
      s5SoundPlan: null,
    });

    const byField = new Map(
      changedFields(prior, current).map((c) => [c.field, c]),
    );

    expect(byField.get("s4ExpectedPopulation")?.kind).toBe("changed");
    expect(byField.get("s4ExpectedPopulation")?.prior).toBe(42);
    expect(byField.get("s4ExpectedPopulation")?.current).toBe(60);

    expect(byField.get("s5NeighbourRequest")?.kind).toBe("added");
    expect(byField.get("s5SoundPlan")?.kind).toBe("cleared");
  });

  it("surfaces a silently emptied sound plan rather than omitting it", () => {
    // The regression this exists for: a reviewer reading a diff must see that a
    // sound plan used to say something and now says nothing.
    const prior = priorRegistration();
    const current = priorRegistration({ s5SoundPlan: "" });

    const changes = changedFields(prior, current);
    expect(changes.map((c) => c.field)).toContain("s5SoundPlan");
    expect(changes.find((c) => c.field === "s5SoundPlan")?.kind).toBe(
      "cleared",
    );
  });

  it("marks the never-carried fields so the UI can explain them", () => {
    const full = diffRegistrations(priorRegistration(), priorRegistration());
    const ack = full.find((c) => c.field === "s6PlugAndPlayAck");
    const plan = full.find((c) => c.field === "s2LntPlan");

    expect(ack?.carried).toBe(false);
    expect(plan?.carried).toBe(true);
  });

  it("labels every field and assigns it a section", () => {
    const full = diffRegistrations({}, {});
    expect(full).toHaveLength(CARRY_FORWARD_FIELDS.length);
    for (const change of full) {
      expect(change.label.length).toBeGreaterThan(0);
      expect(change.sectionLabel.length).toBeGreaterThan(0);
      expect(labelForField(change.field)).toBe(change.label);
      expect(sectionForField(change.field)).toBe(change.section);
    }
  });

  it("treats two blanks as unchanged rather than as a change to nothing", () => {
    const changes = changedFields(
      { s5NeighbourRequest: null },
      { s5NeighbourRequest: "" },
    );
    expect(changes).toEqual([]);
  });
});

describe("summarizeChanges", () => {
  it("counts only what moved", () => {
    const prior = priorRegistration();
    const current = priorRegistration({
      s4ExpectedPopulation: 60,
      s5SoundPlan: null,
    });
    expect(summarizeChanges(diffRegistrations(prior, current), 2026)).toBe(
      "2 changes since 2026",
    );
  });

  it("says so when nothing moved", () => {
    const prior = priorRegistration();
    expect(summarizeChanges(diffRegistrations(prior, prior), 2026)).toBe(
      "No changes since 2026",
    );
  });

  it("uses the singular for one change", () => {
    const prior = priorRegistration();
    const current = priorRegistration({ s4ExpectedPopulation: 43 });
    expect(summarizeChanges(diffRegistrations(prior, current), 2026)).toBe(
      "1 change since 2026",
    );
  });
});

// ── Part two (epic #50) ────────────────────────────────────────────────────

const MAD_HATTERS = "11111111-1111-4111-8111-111111111111";
const CAMP_404 = "22222222-2222-4222-8222-222222222222";

function ref(
  year: number,
  overrides: Partial<PriorRegistrationRef> = {},
): PriorRegistrationRef {
  return {
    registrationId: `reg-${year}`,
    groupId: MAD_HATTERS,
    editionYear: year,
    submittedAt: new Date(`${year}-01-10T00:00:00Z`),
    ...overrides,
  };
}

describe("the rollover rule — no part-two path produces completeness", () => {
  it("never puts completed_sections (or any lifecycle column) in the patch", () => {
    // The chosen-source path runs the SAME patch builder as the latest-source
    // one. If a future change let the patch carry `completedSections`, a camp
    // could pick an old approved registration and submit it unchanged.
    const patch = buildCarryForwardPatch({
      ...priorRegistration(),
      // A prior row as the DB hands it over carries lifecycle columns too.
      ...({
        completedSections: ["identity", "lnt", "participation"],
        status: "approved",
        submittedAt: new Date(),
      } as object),
    } as CarryForwardFields);
    const keys = Object.keys(patch);
    expect(keys).not.toContain("completedSections");
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("submittedAt");
    for (const key of keys) {
      expect(CARRIED_FIELDS as readonly string[]).toContain(key);
    }
  });
});

describe("isValidCarryForwardSource — PREVYR-014", () => {
  const target = { groupId: MAD_HATTERS, editionYear: 2027 };

  it("accepts any strictly earlier edition of the same camp", () => {
    expect(isValidCarryForwardSource(ref(2026), target)).toBe(true);
    expect(isValidCarryForwardSource(ref(2019), target)).toBe(true);
  });

  it("refuses another camp's registration — the id comes from the client", () => {
    expect(
      isValidCarryForwardSource(ref(2026, { groupId: CAMP_404 }), target),
    ).toBe(false);
  });

  it("refuses this edition and any later one", () => {
    expect(isValidCarryForwardSource(ref(2027), target)).toBe(false);
    expect(isValidCarryForwardSource(ref(2028), target)).toBe(false);
  });
});

describe("pastSubmittedRegistrations — PREVYR-001/-011", () => {
  const target = { groupId: MAD_HATTERS, editionYear: 2027 };

  it("lists every submitted prior edition, newest first", () => {
    const list = pastSubmittedRegistrations(
      [ref(2024), ref(2026), ref(2025)],
      target,
    );
    expect(list.map((r) => r.editionYear)).toEqual([2026, 2025, 2024]);
  });

  it("drops never-submitted drafts, other camps, and this edition", () => {
    const list = pastSubmittedRegistrations(
      [
        ref(2026, { submittedAt: null }),
        ref(2025, { groupId: CAMP_404 }),
        ref(2027),
        ref(2024),
      ],
      target,
    );
    expect(list.map((r) => r.registrationId)).toEqual(["reg-2024"]);
  });

  it("wasSubmitted reads submitted_at, not status", () => {
    expect(wasSubmitted({ submittedAt: null })).toBe(false);
    expect(wasSubmitted({ submittedAt: new Date() })).toBe(true);
  });
});

describe("selectComparisonPrior — the reviewer's and the camp's diff", () => {
  it("uses the carried-forward source when there is one, even if older", () => {
    const picked = selectComparisonPrior({
      current: {
        groupId: MAD_HATTERS,
        editionYear: 2027,
        carriedForwardFromId: "reg-2024",
      },
      candidates: [ref(2026), ref(2024)],
    });
    expect(picked?.basis).toBe("carried_forward");
    expect(picked?.prior.editionYear).toBe(2024);
  });

  it("falls back to the previous SUBMITTED edition when nothing was carried", () => {
    const picked = selectComparisonPrior({
      current: {
        groupId: MAD_HATTERS,
        editionYear: 2027,
        carriedForwardFromId: null,
      },
      candidates: [ref(2025), ref(2026, { submittedAt: null })],
    });
    expect(picked?.basis).toBe("previous_edition");
    expect(picked?.prior.editionYear).toBe(2025);
  });

  it("falls back when the carried source is not a valid prior of this camp", () => {
    // A row from another camp must never become this camp's "last year",
    // however the pointer came to name it.
    const picked = selectComparisonPrior({
      current: {
        groupId: MAD_HATTERS,
        editionYear: 2027,
        carriedForwardFromId: "reg-2026",
      },
      candidates: [ref(2026, { groupId: CAMP_404 }), ref(2025)],
    });
    expect(picked?.basis).toBe("previous_edition");
    expect(picked?.prior.registrationId).toBe("reg-2025");
  });

  it("is null for a first-time camp", () => {
    expect(
      selectComparisonPrior({
        current: {
          groupId: MAD_HATTERS,
          editionYear: 2027,
          carriedForwardFromId: null,
        },
        candidates: [],
      }),
    ).toBeNull();
  });
});

describe("canViewCampRegistration", () => {
  it("is exactly the camp's leads and admins", () => {
    const allowed = MembershipRole.options.filter((role) =>
      canViewCampRegistration(role),
    );
    expect(allowed).toEqual(["lead", "admin"]);
    expect(canViewCampRegistration(null)).toBe(false);
  });
});

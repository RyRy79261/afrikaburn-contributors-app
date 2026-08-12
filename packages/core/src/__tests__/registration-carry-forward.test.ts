import { describe, it, expect } from "vitest";
import { formForSection } from "@quagga/types";

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
  type CarryForwardFields,
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
    s2LntPlan: "Sweep grid daily, MOOP bins at every exit, final sweep Tuesday.",
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
      s2LntPlan: "  Sweep grid daily, MOOP bins at every exit, final sweep Tuesday.  ",
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
    expect(changes.find((c) => c.field === "s5SoundPlan")?.kind).toBe("cleared");
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

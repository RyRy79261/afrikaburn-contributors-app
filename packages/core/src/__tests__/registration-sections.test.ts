import { describe, it, expect } from "vitest";
import { SECTION_KEYS } from "@quagga/types";
import {
  isSectionComplete,
  completedSectionsFor,
  type RegistrationSectionData,
} from "../registration-sections";
import { isSubmittable } from "../entitlements";
import { SOUND_SCALE, isNoAmplifiedSound, SOUND_SCALE_VALUES } from "../sound";
import { getPlacementZones, PLACEMENT_ZONES_2027 } from "../placement-zones";

/** A registration with every required field filled — all six sections complete. */
function fullData(): RegistrationSectionData {
  return {
    campName: "Dusty Prototype",
    campDescription: "A calm shade lounge gifting rooibos and quiet.",
    s1ContactEmail: "lead@example.com",

    s2LntPlan: "Two-bin MOOP sweeps daily; grey water evaporated on trays.",
    s2LntLeadName: "Sam Trace",
    s2LntLeadPhone: "+27 82 000 0000",
    s2LntLeadEmail: "lnt@example.com",

    s3ParticipationPlan: "Morning rooibos service and an afternoon shade lounge.",
    s3OperatingHours: ["morning", "day"],
    s3GiftingFood: true,

    s4ExpectedPopulation: 45,
    s4FirstArrivalDate: "2027-04-24",
    s4AreaDimensions: "20m x 15m",

    s5AmplifiedMusic: "Level 1 — Car stereo",
    s5SoundPlan: "Low background music, off during quiet hours.",
    s5PlacementFirstChoice: "Binnekring — back line",
    s5FamilyFriendly: "Yes",

    s6PaidPerformers: false,
    s6FeeStructure: "Members contribute R500 each toward shared infrastructure.",
    s6PlugAndPlayAck: true,
  };
}

describe("per-section completeness predicates", () => {
  it("marks a fully-filled registration complete across all six sections", () => {
    const data = fullData();
    for (const key of SECTION_KEYS) {
      expect(isSectionComplete(key, data)).toBe(true);
    }
    expect(completedSectionsFor(data)).toEqual([...SECTION_KEYS]);
    expect(isSubmittable(completedSectionsFor(data))).toBe(true);
  });

  it("treats an empty draft as zero sections complete (not submittable)", () => {
    expect(completedSectionsFor({})).toEqual([]);
    expect(isSubmittable(completedSectionsFor({}))).toBe(false);
  });

  it("identity requires name, description, and contact email", () => {
    expect(isSectionComplete("identity", { ...fullData(), campName: "  " })).toBe(false);
    expect(
      isSectionComplete("identity", { ...fullData(), s1ContactEmail: null }),
    ).toBe(false);
    expect(
      isSectionComplete("identity", { ...fullData(), campDescription: "" }),
    ).toBe(false);
  });

  it("identity fails when the description blows the 60-word limit", () => {
    const longDescription = Array.from({ length: 61 }, (_, i) => `word${i}`).join(" ");
    expect(
      isSectionComplete("identity", {
        ...fullData(),
        campDescription: longDescription,
      }),
    ).toBe(false);
  });

  it("lnt requires the plan and all three LNT-lead contact fields", () => {
    expect(isSectionComplete("lnt", { ...fullData(), s2LntLeadPhone: "" })).toBe(false);
    expect(isSectionComplete("lnt", { ...fullData(), s2LntPlan: null })).toBe(false);
  });

  it("participation needs a plan, at least one operating-hours slot, and a gifting answer", () => {
    expect(
      isSectionComplete("participation", { ...fullData(), s3OperatingHours: [] }),
    ).toBe(false);
    expect(
      isSectionComplete("participation", { ...fullData(), s3GiftingFood: null }),
    ).toBe(false);
    // false is a real answer, not "unanswered".
    expect(
      isSectionComplete("participation", { ...fullData(), s3GiftingFood: false }),
    ).toBe(true);
  });

  it("size_logistics requires a positive population, arrival date, and dimensions", () => {
    expect(
      isSectionComplete("size_logistics", { ...fullData(), s4ExpectedPopulation: 0 }),
    ).toBe(false);
    expect(
      isSectionComplete("size_logistics", {
        ...fullData(),
        s4ExpectedPopulation: null,
      }),
    ).toBe(false);
    expect(
      isSectionComplete("size_logistics", { ...fullData(), s4AreaDimensions: "" }),
    ).toBe(false);
  });

  it("sound_placement requires a sound plan only when amplified sound is declared", () => {
    // Acoustic camp: no sound plan needed.
    expect(
      isSectionComplete("sound_placement", {
        ...fullData(),
        s5AmplifiedMusic: "No amplified sound",
        s5SoundPlan: null,
      }),
    ).toBe(true);
    // A rig without a sound plan is incomplete.
    expect(
      isSectionComplete("sound_placement", {
        ...fullData(),
        s5AmplifiedMusic: "Level 4 — Large rig",
        s5SoundPlan: "",
      }),
    ).toBe(false);
    // Placement first choice always required.
    expect(
      isSectionComplete("sound_placement", {
        ...fullData(),
        s5PlacementFirstChoice: null,
      }),
    ).toBe(false);
  });

  it("suppliers_commerce requires the Plug & Play acknowledgement", () => {
    expect(
      isSectionComplete("suppliers_commerce", {
        ...fullData(),
        s6PlugAndPlayAck: false,
      }),
    ).toBe(false);
    expect(
      isSectionComplete("suppliers_commerce", {
        ...fullData(),
        s6FeeStructure: "",
      }),
    ).toBe(false);
    expect(
      isSectionComplete("suppliers_commerce", {
        ...fullData(),
        s6PaidPerformers: null,
      }),
    ).toBe(false);
  });
});

describe("sound scale (SOOP levels)", () => {
  it("starts at no-sound and puts a car stereo at Level 1", () => {
    expect(SOUND_SCALE[0]?.value).toBe("No amplified sound");
    expect(SOUND_SCALE[1]?.label).toContain("Level 1");
    expect(SOUND_SCALE[1]?.label.toLowerCase()).toContain("car stereo");
  });

  it("classifies no-amplification vs a rig correctly", () => {
    expect(isNoAmplifiedSound("No amplified sound")).toBe(true);
    expect(isNoAmplifiedSound(null)).toBe(true);
    expect(isNoAmplifiedSound("Level 1 — Car stereo")).toBe(false);
    expect(isNoAmplifiedSound("Level 4 — Large rig")).toBe(false);
  });

  it("exposes stored values that round-trip through the scale", () => {
    expect(SOUND_SCALE_VALUES).toHaveLength(SOUND_SCALE.length);
    for (const option of SOUND_SCALE) {
      expect(SOUND_SCALE_VALUES).toContain(option.value);
    }
  });
});

describe("placement zones", () => {
  it("returns the 2027 zone list for the seeded edition", () => {
    expect(getPlacementZones(2027)).toBe(PLACEMENT_ZONES_2027);
    expect(getPlacementZones(2027).length).toBeGreaterThan(3);
  });

  it("falls back to a sensible default for unknown years", () => {
    expect(getPlacementZones(2030)).toBe(PLACEMENT_ZONES_2027);
  });

  it("includes the real quiet and loud zones from AB's sound guidance", () => {
    const labels = PLACEMENT_ZONES_2027.map((z) => z.label.toLowerCase());
    expect(labels.some((l) => l.includes("quiet"))).toBe(true);
    expect(labels.some((l) => l.includes("loud"))).toBe(true);
  });
});

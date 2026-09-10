import { describe, it, expect } from "vitest";

import {
  buildBioCarryForward,
  BIO_NON_CARRIED_FIELDS,
} from "../bio-carry-forward";
import type { BurnerBioFields, BioExtras } from "../bio";

function priorFields(overrides: Partial<BurnerBioFields> = {}): BurnerBioFields {
  return {
    legalName: "Thandi Mokoena",
    homeCity: "Cape Town",
    bio: "Six burns running, happiest behind a teapot.",
    skills: ["Welding", "First aid"],
    attendedYears: [2023, 2024, 2026],
    firstTime: false,
    contactEmail: "thandi@example.com",
    phone: "+27821234567",
    onsiteContactName: "Sipho",
    onsiteContactPhone: "+27829876543",
    offsiteContactName: "Mum",
    offsiteContactPhone: "+27821112222",
    medicalNotes: "Severe bee-sting allergy — EpiPen in the kitchen box.",
    idType: "sa_id",
    idNumber: "9001015800089",
    ...overrides,
  };
}

function priorExtras(): BioExtras {
  return {
    about: "Tea, dust, and the occasional welding job.",
    campHistory: [{ campName: "Mad Hatters", year: 2026 }] as never,
    volunteeringInterests: ["Rangers"],
    volunteeringOther: null,
    rangerTraining: true,
    rangerCurious: false,
    greenDotTraining: false,
  };
}

describe("buildBioCarryForward", () => {
  it("carries the person's self-description forward", () => {
    const carried = buildBioCarryForward({
      fields: priorFields(),
      extras: priorExtras(),
      privacyFlags: { bio: true, skills: true },
    });

    expect(carried.fields.legalName).toBe("Thandi Mokoena");
    expect(carried.fields.homeCity).toBe("Cape Town");
    expect(carried.fields.skills).toEqual(["Welding", "First aid"]);
    expect(carried.fields.attendedYears).toEqual([2023, 2024, 2026]);
    expect(carried.extras.about).toBe(
      "Tea, dust, and the occasional welding job.",
    );
    expect(carried.extras.rangerTraining).toBe(true);
  });

  it("carries the emergency contacts — a person should confirm them, not retype them", () => {
    const carried = buildBioCarryForward({
      fields: priorFields(),
      extras: priorExtras(),
      privacyFlags: {},
    });

    expect(carried.fields.onsiteContactName).toBe("Sipho");
    expect(carried.fields.offsiteContactPhone).toBe("+27821112222");
  });

  it("carries medical notes", () => {
    // Deliberate. The failure mode of dropping them is a returning burner with a
    // real condition arriving on-site with an empty medical field because
    // re-typing it felt optional. Carried, it is shown back during a flow they
    // must complete, so it gets confirmed or corrected rather than lost.
    const carried = buildBioCarryForward({
      fields: priorFields(),
      extras: priorExtras(),
      privacyFlags: {},
    });

    expect(carried.fields.medicalNotes).toBe(
      "Severe bee-sting allergy — EpiPen in the kitchen box.",
    );
  });

  it("carries the ID document — an SA ID number does not change", () => {
    // Dropping it was an earlier mistake, argued from a retention purge that
    // does not exist: ./id-retention is a pure rule with no caller, so nothing
    // deletes ID data on any schedule today.
    const carried = buildBioCarryForward({
      fields: priorFields(),
      extras: priorExtras(),
      privacyFlags: {},
    });

    expect(carried.fields.idType).toBe("sa_id");
    expect(carried.fields.idNumber).toBe("9001015800089");
  });

  it("carries a passport the same way — editable when it is renewed", () => {
    const carried = buildBioCarryForward({
      fields: priorFields({ idType: "passport", idNumber: "A01234567" }),
      extras: priorExtras(),
      privacyFlags: {},
    });

    expect(carried.fields.idType).toBe("passport");
    expect(carried.fields.idNumber).toBe("A01234567");
  });

  it("resets firstTime — an edition-relative claim", () => {
    const carried = buildBioCarryForward({
      fields: priorFields({ firstTime: true }),
      extras: priorExtras(),
      privacyFlags: {},
    });
    expect(carried.fields.firstTime).toBe(false);
  });

  it("carries privacy choices in both directions", () => {
    const carried = buildBioCarryForward({
      fields: priorFields(),
      extras: priorExtras(),
      privacyFlags: { bio: true, skills: false, homeCity: true },
    });
    expect(carried.privacyFlags).toEqual({
      bio: true,
      skills: false,
      homeCity: true,
    });
  });

  it("does not mutate the prior bio", () => {
    const fields = priorFields({ firstTime: true });
    const extras = priorExtras();
    const flags = { bio: true };
    buildBioCarryForward({ fields, extras, privacyFlags: flags });

    expect(fields.firstTime).toBe(true);
    expect(flags).toEqual({ bio: true });
  });

  it("names every dropped field in one exported list", () => {
    expect([...BIO_NON_CARRIED_FIELDS]).toEqual(["firstTime"]);
  });
});

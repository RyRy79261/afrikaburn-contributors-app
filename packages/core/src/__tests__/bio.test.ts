import { describe, it, expect } from "vitest";
import {
  BIO_PRIVACY_FIELDS,
  defaultPrivacyFlags,
  buildBurnerBioQuestionnaire,
  mapResponsesToBio,
  mapBioToResponses,
  isBioComplete,
  type BurnerBioFields,
} from "../bio";
import {
  HARD_LOCKED_PRIVATE_FIELDS,
  enforcePrivacyFlags,
  privacyViolations,
} from "../privacy";
import { validateResponses } from "@quagga/types";

describe("bio privacy registry ↔ hard-lock", () => {
  it("marks exactly the hard-locked classes as locked", () => {
    const locked = BIO_PRIVACY_FIELDS.filter((f) => f.locked).map((f) => f.key);
    expect(locked.sort()).toEqual([...HARD_LOCKED_PRIVATE_FIELDS].sort());
  });

  it("never defaults a locked field public", () => {
    for (const field of BIO_PRIVACY_FIELDS) {
      if (field.locked) expect(field.defaultPublic).toBe(false);
    }
  });

  it("default flags are already compliant with the hard-lock", () => {
    const flags = defaultPrivacyFlags();
    expect(privacyViolations(flags)).toEqual([]);
    // Locked keys explicitly private, a toggleable public field public.
    expect(flags.phone).toBe(false);
    expect(flags.saId).toBe(false);
    expect(flags.displayName).toBe(true);
  });

  it("cannot be coaxed public — enforce wins over a tampered flag map", () => {
    const tampered = { ...defaultPrivacyFlags(), phone: true, passport: true };
    expect(privacyViolations(tampered).sort()).toEqual(["passport", "phone"]);
    const safe = enforcePrivacyFlags(tampered);
    expect(safe.phone).toBe(false);
    expect(safe.passport).toBe(false);
  });
});

describe("bio questionnaire definition", () => {
  it("is a valid, self-consistent questionnaire", () => {
    const q = buildBurnerBioQuestionnaire();
    // displayName is the single required identity anchor.
    const empty = validateResponses(q, {});
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.displayName).toBeDefined();
  });

  it("accepts a filled-in response set", () => {
    const q = buildBurnerBioQuestionnaire();
    const result = validateResponses(q, {
      displayName: "Dusty Prototype",
      previousAfrikaburns: "3",
      skills: ["build", "sound"],
      firstTime: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe("bio response ⇄ column mapping", () => {
  it("round-trips the core fields", () => {
    const fields: BurnerBioFields = {
      displayName: "Ember",
      legalName: "Jordan Vale",
      homeCity: "Cape Town",
      bio: "Second-year builder.",
      skills: ["build", "welding"],
      previousAfrikaburns: 2,
      firstTime: false,
      contactEmail: "ember@example.com",
      phone: "+27 82 555 1234",
      emergencyContact: {
        name: "Sam Vale",
        phone: "+27 82 555 9999",
        relationship: "sibling",
      },
      medicalNotes: "Bee-sting allergy.",
      idType: "sa_id",
      idNumber: "9001015800089",
    };
    const responses = mapBioToResponses(fields);
    const back = mapResponsesToBio(responses);
    expect(back).toEqual(fields);
  });

  it("collapses an empty emergency contact to null", () => {
    const back = mapResponsesToBio({ displayName: "Solo" });
    expect(back.emergencyContact).toBeNull();
    expect(back.previousAfrikaburns).toBe(0);
    expect(isBioComplete(back)).toBe(true);
  });

  it("treats a missing display name as incomplete", () => {
    expect(isBioComplete({ displayName: null })).toBe(false);
    expect(isBioComplete({ displayName: "  " })).toBe(false);
  });
});

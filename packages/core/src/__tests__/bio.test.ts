import { describe, it, expect } from "vitest";
import {
  BIO_PRIVACY_FIELDS,
  defaultPrivacyFlags,
  initialPrivacyFlags,
  resolvePrivacyFlagsUpdate,
  publicMemberName,
  publicBioView,
  initialsFromName,
  buildBurnerBioQuestionnaire,
  mapResponsesToBio,
  mapBioToResponses,
  parseAttendedYears,
  isBioComplete,
  emptyBioExtras,
  parseVolunteering,
  serializeVolunteering,
  type BioExtras,
  type BurnerBioFields,
} from "../bio";
import {
  HARD_LOCKED_PRIVATE_FIELDS,
  enforcePrivacyFlags,
  privacyViolations,
} from "../privacy";
import {
  VOLUNTEER_PORTFOLIOS,
  isVolunteerPortfolioKey,
  volunteerPortfolioLabel,
  CampHistoryEntry,
  validateResponses,
} from "@quagga/types";

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

describe("privacy-flags write helpers (regression: bio edit must not reset flags)", () => {
  it("initialPrivacyFlags merges defaults, overlays input, and enforces the lock", () => {
    // A brand-new row: caller marks a default-public field private.
    const flags = initialPrivacyFlags({ displayName: false, phone: true });
    expect(flags.displayName).toBe(false); // caller choice honoured
    expect(flags.homeCity).toBe(true); // default retained
    expect(flags.phone).toBe(false); // hard-lock wins over illegal input
  });

  it("initialPrivacyFlags falls back to plain defaults when nothing supplied", () => {
    expect(initialPrivacyFlags()).toEqual(defaultPrivacyFlags());
  });

  it("resolvePrivacyFlagsUpdate returns an EMPTY patch when flags are omitted", () => {
    // The core of the leak fix: a bio-text save (no rawPrivacyFlags) must leave
    // the stored privacy_flags untouched rather than resetting them to defaults.
    const patch = resolvePrivacyFlagsUpdate(undefined);
    expect(patch).toEqual({});
    expect("privacyFlags" in patch).toBe(false);
  });

  it("resolvePrivacyFlagsUpdate returns enforced flags when explicitly supplied", () => {
    const patch = resolvePrivacyFlagsUpdate({ displayName: false, saId: true });
    expect(patch).toEqual({
      privacyFlags: initialPrivacyFlags({ displayName: false, saId: true }),
    });
    // Confirm the user's private choice survives and the lock still applies.
    if ("privacyFlags" in patch) {
      expect(patch.privacyFlags.displayName).toBe(false);
      expect(patch.privacyFlags.saId).toBe(false);
    }
  });

  it("an empty explicit map is still a WRITE (distinct from omission)", () => {
    // {} means "reset to defaults on purpose"; undefined means "leave as-is".
    expect(resolvePrivacyFlagsUpdate({})).toEqual({
      privacyFlags: defaultPrivacyFlags(),
    });
  });
});

describe("publicMemberName (regression: never leak account email)", () => {
  it("uses the display name when present", () => {
    expect(publicMemberName("Dusty Prototype")).toBe("Dusty Prototype");
  });

  it("falls back to a neutral placeholder — never to email — when absent", () => {
    expect(publicMemberName(null)).toBe("Unnamed burner");
    expect(publicMemberName(undefined)).toBe("Unnamed burner");
    expect(publicMemberName("")).toBe("Unnamed burner");
    expect(publicMemberName("   ")).toBe("Unnamed burner");
    // The placeholder must never look like an email address.
    expect(publicMemberName(null)).not.toContain("@");
  });

  it("trims surrounding whitespace on a real name", () => {
    expect(publicMemberName("  Ember  ")).toBe("Ember");
  });
});

describe("publicBioView (third-party profile projection)", () => {
  // A fully-populated bio, including every hard-locked sensitive field.
  const FULL: BurnerBioFields = {
    displayName: "Ember",
    legalName: "Jordan Vale",
    homeCity: "Cape Town",
    bio: "Second-year builder.",
    skills: ["build", "welding"],
    attendedYears: [2019, 2024],
    firstTime: false,
    contactEmail: "ember@example.com",
    phone: "+27825551234",
    onsiteContactName: "Sam Vale",
    onsiteContactPhone: "+27825559999",
    offsiteContactName: "Robin Vale",
    offsiteContactPhone: "+27215550000",
    medicalNotes: "Bee-sting allergy.",
    idType: "sa_id",
    idNumber: "9001015800089",
  };

  it("returns only the fields explicitly flagged public", () => {
    const view = publicBioView(FULL, {
      displayName: true,
      homeCity: true,
      attendedYears: true,
      // legalName + bio + skills + firstTime + contactEmail NOT flagged public
    });
    expect(view.displayName).toBe("Ember");
    expect(view.homeCity).toBe("Cape Town");
    expect(view.attendedYears).toEqual([2019, 2024]);
    // Unflagged toggleable fields are withheld.
    expect(view.legalName).toBeNull();
    expect(view.bio).toBeNull();
    expect(view.skills).toEqual([]);
    expect(view.firstTime).toBeNull();
    expect(view.contactEmail).toBeNull();
  });

  it("withholds a default-public field once the owner marks it private", () => {
    const flags = { ...defaultPrivacyFlags(), homeCity: false };
    const view = publicBioView(FULL, flags);
    expect(view.homeCity).toBeNull();
    // Other defaults still public.
    expect(view.displayName).toBe("Ember");
  });

  it("NEVER leaks a hard-locked field, even when flags claim it is public", () => {
    // A corrupted/hostile flag map claiming every hard-locked class is public.
    const corrupted: Record<string, boolean> = {
      phone: true,
      onsiteContactName: true,
      onsiteContactPhone: true,
      offsiteContactName: true,
      offsiteContactPhone: true,
      medical: true,
      saId: true,
      passport: true,
    };
    const view = publicBioView(FULL, corrupted);
    // No sensitive VALUE appears anywhere in the projection.
    const serialized = JSON.stringify(view);
    for (const secret of [
      FULL.phone,
      FULL.onsiteContactName,
      FULL.onsiteContactPhone,
      FULL.offsiteContactName,
      FULL.offsiteContactPhone,
      FULL.medicalNotes,
      FULL.idNumber,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // And nothing at all was flagged public here, so everything is empty.
    expect(view).toEqual({
      displayName: null,
      legalName: null,
      homeCity: null,
      bio: null,
      skills: [],
      attendedYears: [],
      firstTime: null,
      contactEmail: null,
      about: null,
      campHistory: [],
      volunteeringInterests: [],
      volunteeringOther: null,
      rangerTraining: false,
      rangerCurious: false,
      greenDotTraining: false,
    });
  });

  it("treats a missing flag as private (absent ⇒ not public)", () => {
    const view = publicBioView(FULL, {});
    expect(view.displayName).toBeNull();
    expect(view.homeCity).toBeNull();
  });
});

describe("initialsFromName", () => {
  it("uses first + last initials for a multi-word name", () => {
    expect(initialsFromName("Dusty Prototype")).toBe("DP");
    expect(initialsFromName("  alice   the   hatter ")).toBe("AH");
  });

  it("uses the first two letters of a single-word name", () => {
    expect(initialsFromName("Ember")).toBe("EM");
    expect(initialsFromName("x")).toBe("X");
  });

  it("falls back to a neutral glyph when empty", () => {
    expect(initialsFromName(null)).toBe("?");
    expect(initialsFromName(undefined)).toBe("?");
    expect(initialsFromName("   ")).toBe("?");
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
      attendedYears: ["2019", "2024"],
      skills: ["build", "sound"],
      firstTime: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe("attended-years validation (2020/21 rejection + range)", () => {
  const q = buildBurnerBioQuestionnaire();

  it("accepts real burn years and preserves them", () => {
    const r = validateResponses(q, {
      displayName: "Veteran",
      attendedYears: ["2019", "2023", "2024", "2026"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.responses.attendedYears).toEqual(["2019", "2023", "2024", "2026"]);
  });

  it("rejects 2020 and 2021 — no burn was held", () => {
    for (const year of ["2020", "2021"]) {
      const r = validateResponses(q, {
        displayName: "X",
        attendedYears: [year],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.attendedYears).toBeDefined();
    }
  });

  it("rejects years outside 2007–2026", () => {
    for (const year of ["2006", "2027", "1999", "3000"]) {
      const r = validateResponses(q, {
        displayName: "X",
        attendedYears: [year],
      });
      expect(r.ok).toBe(false);
    }
  });

  it("de-duplicates repeated years", () => {
    const r = validateResponses(q, {
      displayName: "X",
      attendedYears: ["2019", "2019", "2024"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.responses.attendedYears).toEqual(["2019", "2024"]);
  });
});

describe("parseAttendedYears", () => {
  it("keeps valid years, drops invalid, dedupes and sorts ascending", () => {
    expect(
      parseAttendedYears(["2024", "2019", "2019", "2020", "1990", "2027", "2026"]),
    ).toEqual([2019, 2024, 2026]);
  });

  it("accepts numeric input and returns [] for junk", () => {
    expect(parseAttendedYears([2019, 2023])).toEqual([2019, 2023]);
    expect(parseAttendedYears([2020, 2021])).toEqual([]); // no-burn years dropped
    expect(parseAttendedYears(null)).toEqual([]);
    expect(parseAttendedYears("2019")).toEqual([]);
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
      attendedYears: [2019, 2024],
      firstTime: false,
      contactEmail: "ember@example.com",
      phone: "+27825551234",
      onsiteContactName: "Sam Vale",
      onsiteContactPhone: "+27825559999",
      offsiteContactName: "Robin Vale",
      offsiteContactPhone: "+27215550000",
      medicalNotes: "Bee-sting allergy.",
      idType: "sa_id",
      idNumber: "9001015800089",
    };
    const responses = mapBioToResponses(fields);
    const back = mapResponsesToBio(responses);
    expect(back).toEqual(fields);
  });

  it("collapses empty emergency contacts to null and empty years to []", () => {
    const back = mapResponsesToBio({ displayName: "Solo" });
    expect(back.onsiteContactName).toBeNull();
    expect(back.onsiteContactPhone).toBeNull();
    expect(back.offsiteContactName).toBeNull();
    expect(back.offsiteContactPhone).toBeNull();
    expect(back.attendedYears).toEqual([]);
    expect(isBioComplete(back)).toBe(true);
  });

  it("treats a missing display name as incomplete", () => {
    expect(isBioComplete({ displayName: null })).toBe(false);
    expect(isBioComplete({ displayName: "  " })).toBe(false);
  });
});

// --- Burner Bio v3 additions --------------------------------------------

describe("volunteer portfolios (v3)", () => {
  it("exposes exactly the 15 corpus portfolios with unique keys", () => {
    expect(VOLUNTEER_PORTFOLIOS).toHaveLength(15);
    const keys = VOLUNTEER_PORTFOLIOS.map((p) => p.key);
    expect(new Set(keys).size).toBe(15);
  });

  it("validates portfolio keys and resolves labels", () => {
    expect(isVolunteerPortfolioKey("rangers")).toBe(true);
    expect(isVolunteerPortfolioKey("kitchen")).toBe(true);
    expect(isVolunteerPortfolioKey("not_a_portfolio")).toBe(false);
    expect(volunteerPortfolioLabel("rangers")).toBe("Rangers");
    expect(volunteerPortfolioLabel("die_hek")).toBe("Die Hek (Gate)");
    // Unknown keys fall back to the key itself.
    expect(volunteerPortfolioLabel("mystery")).toBe("mystery");
  });
});

describe("volunteering serialize ⇄ parse (keys + free-text other)", () => {
  it("round-trips known keys and a free-text other", () => {
    const stored = serializeVolunteering(["rangers", "kitchen"], "Solar crew");
    expect(stored).toEqual(["rangers", "kitchen", "Solar crew"]);
    const parsed = parseVolunteering(stored);
    expect(parsed.interests).toEqual(["rangers", "kitchen"]);
    expect(parsed.other).toBe("Solar crew");
  });

  it("drops unknown keys from the interest list and tolerates junk input", () => {
    expect(serializeVolunteering(["rangers", "bogus"], null)).toEqual([
      "rangers",
    ]);
    expect(parseVolunteering(null)).toEqual({ interests: [], other: null });
    expect(parseVolunteering(["kitchen"])).toEqual({
      interests: ["kitchen"],
      other: null,
    });
  });
});

describe("camp-history entry shapes (v3 Zod)", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts a linked entry with a groupId", () => {
    const r = CampHistoryEntry.safeParse({
      kind: "linked",
      groupId: uuid,
      label: "Mad Hatters",
      event: "AfrikaBurn",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a free-text entry with no groupId", () => {
    const r = CampHistoryEntry.safeParse({
      kind: "freetext",
      label: "Camp Sparkle Donkey",
      event: "Burning Man",
      years: "2018",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a linked entry missing its groupId", () => {
    expect(
      CampHistoryEntry.safeParse({ kind: "linked", label: "Orphan" }).success,
    ).toBe(false);
  });

  it("rejects a free-text entry that carries a groupId", () => {
    expect(
      CampHistoryEntry.safeParse({
        kind: "freetext",
        groupId: uuid,
        label: "Sneaky",
      }).success,
    ).toBe(false);
  });

  it("requires a non-empty label", () => {
    expect(
      CampHistoryEntry.safeParse({ kind: "freetext", label: "" }).success,
    ).toBe(false);
  });
});

describe("v3 privacy registry (self-promotional — never hard-locked)", () => {
  const v3Keys = ["about", "campHistory", "volunteeringInterests", "ranger"];

  it("registers each v3 field as unlocked and default-public", () => {
    for (const key of v3Keys) {
      const field = BIO_PRIVACY_FIELDS.find((f) => f.key === key);
      expect(field, `missing registry entry for ${key}`).toBeDefined();
      expect(field?.locked).toBe(false);
      expect(field?.defaultPublic).toBe(true);
    }
  });

  it("keeps the hard-locked set unchanged after v3 was added", () => {
    const locked = BIO_PRIVACY_FIELDS.filter((f) => f.locked).map((f) => f.key);
    expect(locked.sort()).toEqual([...HARD_LOCKED_PRIVATE_FIELDS].sort());
  });

  it("defaults every v3 field to public", () => {
    const flags = defaultPrivacyFlags();
    for (const key of v3Keys) expect(flags[key]).toBe(true);
  });
});

describe("publicBioView projects v3 fields (extras + flags)", () => {
  const FIELDS: BurnerBioFields = {
    displayName: "Alice",
    legalName: null,
    homeCity: null,
    bio: null,
    skills: [],
    attendedYears: [],
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
  };
  const EXTRAS: BioExtras = {
    about: "Six burns running.",
    campHistory: [{ kind: "freetext", label: "Camp Sparkle Donkey" }],
    volunteeringInterests: ["rangers", "kitchen"],
    volunteeringOther: "Solar crew",
    rangerTraining: false,
    rangerCurious: true,
    greenDotTraining: false,
  };

  it("passes public v3 fields through when flagged public", () => {
    const view = publicBioView(
      FIELDS,
      {
        about: true,
        campHistory: true,
        volunteeringInterests: true,
        ranger: true,
      },
      EXTRAS,
    );
    expect(view.about).toBe("Six burns running.");
    expect(view.campHistory).toHaveLength(1);
    expect(view.volunteeringInterests).toEqual(["rangers", "kitchen"]);
    expect(view.volunteeringOther).toBe("Solar crew");
    expect(view.rangerCurious).toBe(true);
  });

  it("withholds each v3 field once its flag is private", () => {
    const view = publicBioView(
      FIELDS,
      {
        about: false,
        campHistory: false,
        volunteeringInterests: false,
        ranger: false,
      },
      EXTRAS,
    );
    expect(view.about).toBeNull();
    expect(view.campHistory).toEqual([]);
    expect(view.volunteeringInterests).toEqual([]);
    expect(view.volunteeringOther).toBeNull();
    expect(view.rangerCurious).toBe(false);
    expect(view.rangerTraining).toBe(false);
    expect(view.greenDotTraining).toBe(false);
  });

  it("the single 'ranger' flag governs all three ranger booleans", () => {
    const extras: BioExtras = {
      ...emptyBioExtras(),
      rangerTraining: true,
      rangerCurious: true,
      greenDotTraining: true,
    };
    const shown = publicBioView(FIELDS, { ranger: true }, extras);
    expect(shown.rangerTraining).toBe(true);
    expect(shown.greenDotTraining).toBe(true);
    const hidden = publicBioView(FIELDS, { ranger: false }, extras);
    expect(hidden.rangerTraining).toBe(false);
    expect(hidden.greenDotTraining).toBe(false);
  });

  it("defaults to empty extras when none are supplied (back-compat)", () => {
    const view = publicBioView(FIELDS, { about: true });
    expect(view.about).toBeNull();
    expect(view.campHistory).toEqual([]);
  });
});

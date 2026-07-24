import { describe, it, expect } from "vitest";
import {
  BIO_PRIVACY_FIELDS,
  defaultPrivacyFlags,
  initialPrivacyFlags,
  resolvePrivacyFlagsUpdate,
  publicMemberName,
  buildBurnerBioQuestionnaire,
  mapResponsesToBio,
  mapBioToResponses,
  parseAttendedYears,
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

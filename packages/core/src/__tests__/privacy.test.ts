import { describe, it, expect } from "vitest";
import {
  HARD_LOCKED_PRIVATE_FIELDS,
  isHardLockedPrivate,
  canBePublic,
  enforcePrivacyFlags,
  privacyViolations,
} from "../privacy";
import { officerContactVisibleToOrg } from "../officers";

describe("privacy hard-lock", () => {
  it("locks id, passport, phone, both emergency contacts, and medical", () => {
    for (const field of [
      "saId",
      "passport",
      "phone",
      "onsiteContactName",
      "onsiteContactPhone",
      "offsiteContactName",
      "offsiteContactPhone",
      "medical",
    ]) {
      expect(isHardLockedPrivate(field)).toBe(true);
      expect(canBePublic(field)).toBe(false);
    }
    expect(HARD_LOCKED_PRIVATE_FIELDS).toHaveLength(8);
  });

  it("allows ordinary fields to be public", () => {
    expect(canBePublic("displayName")).toBe(true);
    expect(canBePublic("bio")).toBe(true);
    expect(canBePublic("attendedYears")).toBe(true);
  });

  it("forces every hard-locked flag to private, even if set public", () => {
    const enforced = enforcePrivacyFlags({
      displayName: true,
      bio: true,
      phone: true, // illegal attempt
      saId: true, // illegal attempt
      onsiteContactPhone: true, // illegal attempt
      offsiteContactName: true, // illegal attempt
    });
    expect(enforced.displayName).toBe(true);
    expect(enforced.bio).toBe(true);
    expect(enforced.phone).toBe(false);
    expect(enforced.saId).toBe(false);
    expect(enforced.passport).toBe(false);
    expect(enforced.onsiteContactName).toBe(false);
    expect(enforced.onsiteContactPhone).toBe(false);
    expect(enforced.offsiteContactName).toBe(false);
    expect(enforced.offsiteContactPhone).toBe(false);
  });

  it("reports which hard-locked fields were illegally set public", () => {
    expect(privacyViolations({ displayName: true })).toEqual([]);
    expect(
      privacyViolations({
        phone: true,
        medical: true,
        bio: true,
        offsiteContactPhone: true,
      }).sort(),
    ).toEqual(["medical", "offsiteContactPhone", "phone"]);
  });
});

describe("officer exception is the only path exposing phone", () => {
  it("bio phone stays hard-locked private regardless of officer state", () => {
    // Even for someone who is an accepted officer, the BIO privacy flag for
    // phone can never be set public — officer org-visibility is a SEPARATE,
    // explicit channel, not a change to the bio hard-lock.
    const enforced = enforcePrivacyFlags({ phone: true });
    expect(enforced.phone).toBe(false);
    expect(isHardLockedPrivate("phone")).toBe(true);
  });

  it("officerContactVisibleToOrg is the sole gate that exposes contact", () => {
    expect(officerContactVisibleToOrg({ isOfficer: true, consent: "accepted" })).toBe(true);
    expect(officerContactVisibleToOrg({ isOfficer: true, consent: "pending" })).toBe(false);
    expect(officerContactVisibleToOrg({ isOfficer: false, consent: "accepted" })).toBe(false);
  });
});

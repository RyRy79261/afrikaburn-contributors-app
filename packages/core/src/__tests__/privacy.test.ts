import { describe, it, expect } from "vitest";
import {
  HARD_LOCKED_PRIVATE_FIELDS,
  isHardLockedPrivate,
  canBePublic,
  enforcePrivacyFlags,
  privacyViolations,
} from "../privacy";

describe("privacy hard-lock", () => {
  it("locks id, passport, phone, emergency contact, and medical", () => {
    for (const field of [
      "saId",
      "passport",
      "phone",
      "emergencyContact",
      "medical",
    ]) {
      expect(isHardLockedPrivate(field)).toBe(true);
      expect(canBePublic(field)).toBe(false);
    }
    expect(HARD_LOCKED_PRIVATE_FIELDS).toHaveLength(5);
  });

  it("allows ordinary fields to be public", () => {
    expect(canBePublic("displayName")).toBe(true);
    expect(canBePublic("bio")).toBe(true);
  });

  it("forces every hard-locked flag to private, even if set public", () => {
    const enforced = enforcePrivacyFlags({
      displayName: true,
      bio: true,
      phone: true, // illegal attempt
      saId: true, // illegal attempt
    });
    expect(enforced.displayName).toBe(true);
    expect(enforced.bio).toBe(true);
    expect(enforced.phone).toBe(false);
    expect(enforced.saId).toBe(false);
    expect(enforced.passport).toBe(false);
  });

  it("reports which hard-locked fields were illegally set public", () => {
    expect(privacyViolations({ displayName: true })).toEqual([]);
    expect(
      privacyViolations({ phone: true, medical: true, bio: true }).sort(),
    ).toEqual(["medical", "phone"]);
  });
});

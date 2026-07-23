import { describe, it, expect } from "vitest";
import {
  MembershipRole,
  GroupKind,
  isProjectKind,
  RegistrationStatus,
  SECTION_KEYS,
  SECTION_LABELS,
  PaymentStatus,
  VettingStatus,
  validateOne,
} from "../index";

describe("shared enums", () => {
  it("accepts every membership role and rejects unknowns", () => {
    for (const role of ["god", "org_staff", "lead", "admin", "member"]) {
      expect(MembershipRole.safeParse(role).success).toBe(true);
    }
    expect(MembershipRole.safeParse("captain").success).toBe(false);
  });

  it("classifies project vs org kinds", () => {
    expect(isProjectKind(GroupKind.parse("theme_camp"))).toBe(true);
    expect(isProjectKind(GroupKind.parse("org"))).toBe(false);
  });

  it("has exactly six ordered sections with labels", () => {
    expect(SECTION_KEYS).toHaveLength(6);
    for (const key of SECTION_KEYS) {
      expect(SECTION_LABELS[key]).toBeTruthy();
    }
  });

  it("locks the registration and money vocabularies", () => {
    expect(RegistrationStatus.safeParse("approved").success).toBe(true);
    expect(RegistrationStatus.safeParse("cancelled").success).toBe(false);
    expect(PaymentStatus.safeParse("reconciled").success).toBe(true);
    expect(VettingStatus.safeParse("flagged").success).toBe(true);
  });
});

describe("questionnaire validateOne", () => {
  it("requires a value for required questions", () => {
    const q = {
      id: "contact_email",
      kind: "email",
      prompt: "Contact email",
      required: true,
    } as const;
    expect(validateOne(q, "")).toEqual({
      ok: false,
      error: "This question is required",
    });
    expect(validateOne(q, "dusty@example.com")).toEqual({
      ok: true,
      value: "dusty@example.com",
    });
    expect(validateOne(q, "not-an-email").ok).toBe(false);
  });
});

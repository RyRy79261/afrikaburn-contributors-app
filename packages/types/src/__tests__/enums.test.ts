import { describe, it, expect } from "vitest";
import {
  MembershipRole,
  GroupKind,
  isProjectKind,
  RegistrationStatus,
  SECTION_KEYS,
  SECTION_LABELS,
  PaymentStatus,
  SupplierStanding,
  SupplierReturning,
  SupplierNoteKind,
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
  });

  it("locks the supplier standing + returning + note-kind vocabularies", () => {
    for (const s of [
      "good",
      "watch",
      "suspended",
      "diligent_first_timer",
      "adapting",
      "absolute_beginner",
    ]) {
      expect(SupplierStanding.safeParse(s).success).toBe(true);
    }
    // The dead v1 vetting vocabulary must not survive.
    expect(SupplierStanding.safeParse("flagged").success).toBe(false);
    expect(SupplierStanding.safeParse("registered").success).toBe(false);

    for (const r of ["newbie", "returning"]) {
      expect(SupplierReturning.safeParse(r).success).toBe(true);
    }
    expect(SupplierReturning.safeParse("veteran").success).toBe(false);

    for (const k of ["infraction", "blessing", "note"]) {
      expect(SupplierNoteKind.safeParse(k).success).toBe(true);
    }
    expect(SupplierNoteKind.safeParse("praise").success).toBe(false);
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

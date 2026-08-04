import { describe, it, expect } from "vitest";
import {
  FORM_1_SECTION_KEYS,
  FORM_2_SECTION_KEYS,
  MAX_LAYOUT_UPLOADS,
  OperatingHours,
  RegistrationStatus,
  SECTION_KEYS,
  SectionReviewStatus,
  formForSection,
} from "../index";

// The two-form split is the reason a September applicant is not asked their
// January answers — `isSubmittable` in @quagga/core gates on FORM_1_SECTION_KEYS
// alone. If a section silently moved between forms, that gate would change
// meaning and nothing anywhere would go red. Hence the partition assertions.
// (enums.test.ts already pins the six keys and their labels.)

describe("which form a section belongs to", () => {
  it("puts size & logistics and sound & placement in Form 2, the rest in Form 1", () => {
    const byForm: Record<string, 1 | 2> = {
      identity: 1,
      lnt: 1,
      participation: 1,
      size_logistics: 2,
      sound_placement: 2,
      suppliers_commerce: 1,
    };
    // Driven off SECTION_KEYS so a seventh section cannot be added without
    // landing in a form here.
    for (const key of SECTION_KEYS) {
      expect(formForSection(key), key).toBe(byForm[key]);
    }
    expect(Object.keys(byForm).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it("keeps participation in Form 1 despite AfrikaBurn's own Form-2 heading", () => {
    // Named on purpose: the source comment warns a future reader will be
    // tempted to move it, and splitting section 3 would give one review thread
    // two halves answered five months apart.
    expect(formForSection("participation")).toBe(1);
    expect(FORM_1_SECTION_KEYS).toContain("participation");
  });

  it("partitions the six sections exactly — no overlap, no gap", () => {
    // The invariant the whole two-form split rests on.
    const union = [...FORM_1_SECTION_KEYS, ...FORM_2_SECTION_KEYS];
    expect(union.sort()).toEqual([...SECTION_KEYS].sort());
    expect(new Set(union).size).toBe(SECTION_KEYS.length);
    for (const key of FORM_1_SECTION_KEYS) {
      expect(FORM_2_SECTION_KEYS).not.toContain(key);
    }
  });
});

describe("registration vocabularies", () => {
  it("accepts the whole lifecycle and refuses an invented status", () => {
    for (const status of [
      "draft",
      "submitted",
      "under_review",
      "changes_requested",
      "approved",
      "rejected",
      "withdrawn",
    ]) {
      expect(RegistrationStatus.safeParse(status).success, status).toBe(true);
    }
    expect(RegistrationStatus.safeParse("cancelled").success).toBe(false);
  });

  it("keeps the review thread and operating-hours vocabularies closed", () => {
    for (const s of ["open", "resolved"]) {
      expect(SectionReviewStatus.safeParse(s).success, s).toBe(true);
    }
    expect(SectionReviewStatus.safeParse("archived").success).toBe(false);

    for (const h of ["morning", "day", "night", "late_night"]) {
      expect(OperatingHours.safeParse(h).success, h).toBe(true);
    }
    expect(OperatingHours.safeParse("all_day").success).toBe(false);
  });

  it("caps layout uploads at four", () => {
    expect(MAX_LAYOUT_UPLOADS).toBe(4);
  });
});

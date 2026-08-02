import { describe, it, expect } from "vitest";
import {
  isRegistered,
  isApprovedRegistration,
  isFullyComplete,
  isSubmittable,
  missingForm2Sections,
  missingSections,
} from "../entitlements";
import {
  FORM_1_SECTION_KEYS,
  FORM_2_SECTION_KEYS,
  SECTION_KEYS,
} from "@quagga/types";

describe("isRegistered", () => {
  it("is true iff an approved registration exists", () => {
    expect(isRegistered([{ status: "approved" }])).toBe(true);
    expect(
      isRegistered([{ status: "submitted" }, { status: "approved" }]),
    ).toBe(true);
  });

  it("is false with no rows or no approved row", () => {
    expect(isRegistered([])).toBe(false);
    expect(
      isRegistered([{ status: "draft" }, { status: "changes_requested" }]),
    ).toBe(false);
  });

  it("isApprovedRegistration handles a single nullable row", () => {
    expect(isApprovedRegistration({ status: "approved" })).toBe(true);
    expect(isApprovedRegistration({ status: "rejected" })).toBe(false);
    expect(isApprovedRegistration(null)).toBe(false);
  });
});

describe("submit gate", () => {
  // THE GATE IS FORM 1's, NOT ALL SIX (roadmap M4-20). AfrikaBurn asks size,
  // placement, sound and the layout diagram in JANUARY, months after Form 1
  // opens in September. A September applicant cannot answer them, so gating
  // submission on them would have held the whole registration season at
  // "4 of 6 complete" — the season this product exists to run.
  it("requires the Form 1 sections and only those", () => {
    expect(isSubmittable(FORM_1_SECTION_KEYS)).toBe(true);
    expect(isSubmittable(SECTION_KEYS)).toBe(true);
  });

  it("does NOT require the Form 2 sections", () => {
    // The exact shape of a real September applicant: everything they were asked
    // for, nothing they were not.
    expect(isSubmittable(["identity", "lnt", "participation", "suppliers_commerce"])).toBe(true);
    // And the inverse — Form 2 alone submits nothing.
    expect(isSubmittable(FORM_2_SECTION_KEYS)).toBe(false);
  });

  it("still refuses an incomplete Form 1", () => {
    expect(isSubmittable([...FORM_1_SECTION_KEYS].slice(0, 3))).toBe(false);
    expect(isSubmittable([])).toBe(false);
    // A camp that answered every Form 2 question but skipped one of Form 1's is
    // not submittable, however full the row looks.
    expect(
      isSubmittable(["identity", "lnt", "participation", ...FORM_2_SECTION_KEYS]),
    ).toBe(false);
  });

  it("lists only the outstanding FORM 1 sections", () => {
    expect(missingSections(FORM_1_SECTION_KEYS)).toEqual([]);
    // Not "size_logistics, sound_placement" — telling a camp in September that
    // it is missing sections that have not opened is telling it it has failed
    // at something it was never asked.
    expect(missingSections(["identity", "lnt"])).toEqual([
      "participation",
      "suppliers_commerce",
    ]);
  });

  it("tracks the Form 2 sections separately, and the full picture", () => {
    expect(missingForm2Sections(FORM_1_SECTION_KEYS)).toEqual([
      "size_logistics",
      "sound_placement",
    ]);
    expect(missingForm2Sections(SECTION_KEYS)).toEqual([]);

    // `isFullyComplete` is what placement eventually needs; a submitted-but-
    // pre-January registration is submittable and NOT fully complete, and both
    // of those are true at the same time on purpose.
    expect(isFullyComplete(FORM_1_SECTION_KEYS)).toBe(false);
    expect(isFullyComplete(SECTION_KEYS)).toBe(true);
  });

  // Wave 1 (registration lane) owns turning the gate into a submit action and
  // deriving the entitlement TILES (containers/water/placement) from approval.
  it.todo("derives entitlement tiles from an approved registration");
});

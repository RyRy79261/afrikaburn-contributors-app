import { describe, it, expect } from "vitest";
import {
  isRegistered,
  isApprovedRegistration,
  isSubmittable,
  missingSections,
} from "../entitlements";
import { SECTION_KEYS } from "@quagga/types";

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
  it("requires all six sections complete", () => {
    expect(isSubmittable(SECTION_KEYS)).toBe(true);
    expect(isSubmittable([...SECTION_KEYS].slice(0, 5))).toBe(false);
    expect(isSubmittable([])).toBe(false);
  });

  it("lists the outstanding sections", () => {
    expect(missingSections(SECTION_KEYS)).toEqual([]);
    expect(missingSections(["identity", "lnt"])).toEqual([
      "participation",
      "size_logistics",
      "sound_placement",
      "suppliers_commerce",
    ]);
  });

  // Wave 1 (registration lane) owns turning the gate into a submit action and
  // deriving the entitlement TILES (containers/water/placement) from approval.
  it.todo("derives entitlement tiles from an approved registration");
});

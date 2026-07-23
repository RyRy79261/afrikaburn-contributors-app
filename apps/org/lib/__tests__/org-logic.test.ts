import { describe, it, expect } from "vitest";
import type { RegistrationStatus } from "@quagga/types";
import {
  resolveReviewAction,
  resolveReviewActionPath,
  availableReviewActions,
  isReviewActionAvailable,
  deriveCohort,
  classifySoundLevel,
  REVIEW_ACTION_TARGET,
} from "../org-logic";

describe("resolveReviewAction — legal transitions only", () => {
  it("starts review directly from submitted", () => {
    expect(resolveReviewAction("submitted", "start_review")).toBe(
      "under_review",
    );
    expect(resolveReviewActionPath("submitted", "start_review")).toEqual([
      "under_review",
    ]);
  });

  it("approves directly from under_review", () => {
    expect(resolveReviewAction("under_review", "approve")).toBe("approved");
    expect(resolveReviewActionPath("under_review", "approve")).toEqual([
      "approved",
    ]);
  });

  it("routes approve on a freshly submitted registration via under_review", () => {
    expect(resolveReviewActionPath("submitted", "approve")).toEqual([
      "under_review",
      "approved",
    ]);
    expect(resolveReviewAction("submitted", "approve")).toBe("approved");
  });

  it("routes reject on a submitted registration via under_review", () => {
    expect(resolveReviewActionPath("submitted", "reject")).toEqual([
      "under_review",
      "rejected",
    ]);
  });

  it("requests changes directly from both submitted and under_review", () => {
    expect(resolveReviewAction("submitted", "request_changes")).toBe(
      "changes_requested",
    );
    expect(resolveReviewAction("under_review", "request_changes")).toBe(
      "changes_requested",
    );
  });

  it("rejects illegal actions on terminal / pre-submission states", () => {
    const illegal: [RegistrationStatus, Parameters<typeof resolveReviewAction>[1]][] =
      [
        ["draft", "approve"],
        ["draft", "start_review"],
        ["approved", "approve"],
        ["approved", "reject"],
        ["rejected", "approve"],
        ["withdrawn", "start_review"],
        ["changes_requested", "approve"],
      ];
    for (const [from, action] of illegal) {
      expect(() => resolveReviewAction(from, action)).toThrow();
      expect(isReviewActionAvailable(from, action)).toBe(false);
    }
  });

  it("never invents an action target outside the enum", () => {
    for (const target of Object.values(REVIEW_ACTION_TARGET)) {
      expect([
        "under_review",
        "approved",
        "changes_requested",
        "rejected",
      ]).toContain(target);
    }
  });

  it("offers the expected action menu per status", () => {
    expect(availableReviewActions("draft")).toEqual([]);
    expect(availableReviewActions("submitted").sort()).toEqual(
      ["approve", "reject", "request_changes", "start_review"].sort(),
    );
    expect(availableReviewActions("under_review").sort()).toEqual(
      ["approve", "reject", "request_changes"].sort(),
    );
    expect(availableReviewActions("changes_requested")).toEqual([]);
    expect(availableReviewActions("approved")).toEqual([]);
    expect(availableReviewActions("rejected")).toEqual([]);
    expect(availableReviewActions("withdrawn")).toEqual([]);
  });
});

describe("deriveCohort", () => {
  it("is returning with a prior registration, new otherwise", () => {
    expect(deriveCohort(true)).toBe("returning");
    expect(deriveCohort(false)).toBe("new");
  });
});

describe("classifySoundLevel", () => {
  it("extracts the numeric level", () => {
    expect(classifySoundLevel("Level 2 — car stereo")).toBe("level_2");
    expect(classifySoundLevel("level 4 large rig")).toBe("level_4");
    expect(classifySoundLevel("1")).toBe("level_1");
  });

  it("maps explicit no-sound phrasing to none", () => {
    expect(classifySoundLevel("No amplified sound")).toBe("none");
    expect(classifySoundLevel("none")).toBe("none");
    expect(classifySoundLevel("Silent camp")).toBe("none");
  });

  it("returns unspecified for empty / unknown", () => {
    expect(classifySoundLevel(null)).toBe("unspecified");
    expect(classifySoundLevel("")).toBe("unspecified");
    expect(classifySoundLevel("   ")).toBe("unspecified");
    expect(classifySoundLevel("acoustic only")).toBe("unspecified");
  });
});

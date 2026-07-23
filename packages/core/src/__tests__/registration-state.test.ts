import { describe, it, expect } from "vitest";
import {
  canTransitionRegistration,
  assertRegistrationTransition,
  canTransitionSectionReview,
  REGISTRATION_TRANSITIONS,
} from "../registration-state";

describe("registration state machine", () => {
  it("allows the happy path draft → submitted → under_review → approved", () => {
    expect(canTransitionRegistration("draft", "submitted")).toBe(true);
    expect(canTransitionRegistration("submitted", "under_review")).toBe(true);
    expect(canTransitionRegistration("under_review", "approved")).toBe(true);
  });

  it("allows the changes-requested resubmit loop", () => {
    expect(canTransitionRegistration("under_review", "changes_requested")).toBe(
      true,
    );
    expect(canTransitionRegistration("changes_requested", "submitted")).toBe(
      true,
    );
  });

  it("treats rejected and withdrawn as terminal", () => {
    expect(REGISTRATION_TRANSITIONS.rejected).toEqual([]);
    expect(REGISTRATION_TRANSITIONS.withdrawn).toEqual([]);
    expect(canTransitionRegistration("rejected", "submitted")).toBe(false);
  });

  it("forbids illegal jumps", () => {
    expect(canTransitionRegistration("draft", "approved")).toBe(false);
    expect(canTransitionRegistration("approved", "draft")).toBe(false);
  });

  it("assertRegistrationTransition throws on an illegal move, returns the target otherwise", () => {
    expect(assertRegistrationTransition("draft", "submitted")).toBe(
      "submitted",
    );
    expect(() => assertRegistrationTransition("draft", "approved")).toThrow();
  });
});

describe("section-review state machine", () => {
  it("opens, resolves, and reopens", () => {
    expect(canTransitionSectionReview("open", "resolved")).toBe(true);
    expect(canTransitionSectionReview("resolved", "open")).toBe(true);
  });
});

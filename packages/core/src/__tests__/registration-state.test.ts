import { describe, it, expect } from "vitest";
import type { RegistrationStatus } from "@quagga/types";
import { RegistrationStatus as RegistrationStatusEnum } from "@quagga/types";
import {
  canTransitionRegistration,
  assertRegistrationTransition,
  canTransitionSectionReview,
  canReplyToSectionReview,
  REGISTRATION_TRANSITIONS,
  SECTION_REVIEW_TRANSITIONS,
  canCampSubmit,
  canCampWithdraw,
  resolveCampAction,
  CAMP_ACTIONS,
} from "../registration-state";

const ALL_STATUSES = RegistrationStatusEnum.options as readonly RegistrationStatus[];

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

  it("lets the org request changes straight from submitted (skipping review)", () => {
    expect(canTransitionRegistration("submitted", "changes_requested")).toBe(
      true,
    );
  });

  it("treats rejected as terminal — AfrikaBurn's decision, not the camp's", () => {
    expect(REGISTRATION_TRANSITIONS.rejected).toEqual([]);
    for (const to of ALL_STATUSES) {
      expect(canTransitionRegistration("rejected", to)).toBe(false);
    }
  });

  it("lets a WITHDRAWN registration be reopened as a draft", () => {
    // The camp withdrew its own registration, and the confirm dialog promises
    // it can "register again". `withdrawn: []` made that a lie with no way out:
    // one row per (group, edition), the wizard read-only outside draft /
    // changes_requested, and the console refusing every action out of
    // withdrawn. Reopening returns it to the camp's own editable state.
    expect(canTransitionRegistration("withdrawn", "draft")).toBe(true);
    for (const to of ALL_STATUSES) {
      if (to === "draft") continue;
      expect(canTransitionRegistration("withdrawn", to)).toBe(false);
    }
  });

  it("allows withdrawal from every non-terminal, non-withdrawn state", () => {
    expect(canTransitionRegistration("draft", "withdrawn")).toBe(true);
    expect(canTransitionRegistration("submitted", "withdrawn")).toBe(true);
    expect(canTransitionRegistration("under_review", "withdrawn")).toBe(false); // review must decide or bounce first
    expect(canTransitionRegistration("changes_requested", "withdrawn")).toBe(true);
    expect(canTransitionRegistration("approved", "withdrawn")).toBe(true);
  });

  it("forbids illegal jumps", () => {
    expect(canTransitionRegistration("draft", "approved")).toBe(false);
    expect(canTransitionRegistration("draft", "under_review")).toBe(false);
    expect(canTransitionRegistration("draft", "changes_requested")).toBe(false);
    expect(canTransitionRegistration("approved", "draft")).toBe(false);
    expect(canTransitionRegistration("approved", "submitted")).toBe(false);
    expect(canTransitionRegistration("submitted", "approved")).toBe(false);
    expect(canTransitionRegistration("changes_requested", "approved")).toBe(false);
  });

  it("never lists a self-transition and never targets an unknown status", () => {
    for (const from of ALL_STATUSES) {
      for (const to of REGISTRATION_TRANSITIONS[from]) {
        expect(to).not.toBe(from);
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it("assertRegistrationTransition throws on an illegal move, returns the target otherwise", () => {
    expect(assertRegistrationTransition("draft", "submitted")).toBe("submitted");
    expect(() => assertRegistrationTransition("draft", "approved")).toThrow(
      /Illegal registration transition/,
    );
    expect(() => assertRegistrationTransition("rejected", "submitted")).toThrow(
      /terminal state/,
    );
  });
});

describe("camp-side actions", () => {
  it("submit and resubmit both target submitted from their legal origins", () => {
    expect(resolveCampAction("draft", "submit")).toBe("submitted");
    expect(resolveCampAction("changes_requested", "resubmit")).toBe("submitted");
  });

  it("withdraw targets withdrawn", () => {
    expect(resolveCampAction("draft", "withdraw")).toBe("withdrawn");
    expect(resolveCampAction("approved", "withdraw")).toBe("withdrawn");
  });

  it("rejects an illegal camp action", () => {
    expect(() => resolveCampAction("approved", "submit")).toThrow();
    expect(() => resolveCampAction("under_review", "withdraw")).toThrow();
    expect(() => resolveCampAction("rejected", "resubmit")).toThrow();
  });

  it("canCampSubmit / canCampWithdraw agree with the state machine", () => {
    expect(canCampSubmit("draft")).toBe(true);
    expect(canCampSubmit("changes_requested")).toBe(true);
    expect(canCampSubmit("submitted")).toBe(false);
    expect(canCampSubmit("approved")).toBe(false);

    expect(canCampWithdraw("draft")).toBe(true);
    expect(canCampWithdraw("approved")).toBe(true);
    expect(canCampWithdraw("rejected")).toBe(false);
  });

  it("exposes exactly the four camp actions", () => {
    expect(CAMP_ACTIONS).toEqual([
      "submit",
      "resubmit",
      "withdraw",
      // The way back from a voluntary withdrawal — the "register again" the
      // withdraw dialog promises. Deliberately no equivalent out of `rejected`.
      "reopen",
    ]);
  });
});

describe("section-review state machine", () => {
  it("opens, resolves, and reopens", () => {
    expect(canTransitionSectionReview("open", "resolved")).toBe(true);
    expect(canTransitionSectionReview("resolved", "open")).toBe(true);
  });

  it("has no self-transitions", () => {
    expect(SECTION_REVIEW_TRANSITIONS.open).not.toContain("open");
    expect(SECTION_REVIEW_TRANSITIONS.resolved).not.toContain("resolved");
  });
});

describe("canReplyToSectionReview", () => {
  it("allows any camp member of the camp under review", () => {
    expect(canReplyToSectionReview({ campRole: "member", isOrgStaff: false })).toBe(
      true,
    );
    expect(canReplyToSectionReview({ campRole: "lead", isOrgStaff: false })).toBe(
      true,
    );
    expect(canReplyToSectionReview({ campRole: "admin", isOrgStaff: false })).toBe(
      true,
    );
  });

  it("allows org staff even with no camp membership", () => {
    expect(canReplyToSectionReview({ campRole: null, isOrgStaff: true })).toBe(
      true,
    );
  });

  it("refuses a non-member who is not org staff", () => {
    expect(canReplyToSectionReview({ campRole: null, isOrgStaff: false })).toBe(
      false,
    );
  });
});

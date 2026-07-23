import type { RegistrationStatus, SectionReviewStatus } from "@quagga/types";

// Registration + section-review state machines (build-spec §Core logic): only
// legal transitions. The skeleton is defined here; wave 1 (registration lane)
// wires the actions that call `assertRegistrationTransition`.

/** Legal next-states for each registration status. */
export const REGISTRATION_TRANSITIONS: Record<
  RegistrationStatus,
  readonly RegistrationStatus[]
> = {
  // Camp is drafting — can submit or abandon.
  draft: ["submitted", "withdrawn"],
  // Submitted — AB begins review, or the camp withdraws.
  submitted: ["under_review", "changes_requested", "withdrawn"],
  // Under review — AB decides, or asks for changes.
  under_review: ["approved", "rejected", "changes_requested"],
  // Changes requested — camp updates and resubmits, or withdraws.
  changes_requested: ["submitted", "withdrawn"],
  // Approved — the entitlement-granting state; only a voluntary withdrawal.
  approved: ["withdrawn"],
  // Terminal states.
  rejected: [],
  withdrawn: [],
};

/** Whether `from → to` is a legal registration transition. */
export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  return REGISTRATION_TRANSITIONS[from].includes(to);
}

/** Throw on an illegal registration transition; otherwise return `to`. */
export function assertRegistrationTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
): RegistrationStatus {
  if (!canTransitionRegistration(from, to)) {
    throw new Error(
      `Illegal registration transition: ${from} → ${to}. Allowed: ${
        REGISTRATION_TRANSITIONS[from].join(", ") || "(none — terminal state)"
      }`,
    );
  }
  return to;
}

/** Legal next-states for a per-section review thread. */
export const SECTION_REVIEW_TRANSITIONS: Record<
  SectionReviewStatus,
  readonly SectionReviewStatus[]
> = {
  open: ["resolved"],
  resolved: ["open"], // reopenable
};

/** Whether `from → to` is a legal section-review transition. */
export function canTransitionSectionReview(
  from: SectionReviewStatus,
  to: SectionReviewStatus,
): boolean {
  return SECTION_REVIEW_TRANSITIONS[from].includes(to);
}

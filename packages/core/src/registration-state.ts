import type {
  MembershipRole,
  RegistrationStatus,
  SectionReviewStatus,
} from "@quagga/types";

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

// --- Camp-side actions ---------------------------------------------------
// The three actions a camp can take on its own registration, each resolved
// through the SAME state machine the org console uses (single source of truth
// for legal transitions — build-spec §Core logic). The wizard's server actions
// call these instead of hard-coding target statuses.

export const CAMP_ACTIONS = ["submit", "resubmit", "withdraw"] as const;
export type CampAction = (typeof CAMP_ACTIONS)[number];

/** Whether the camp may submit/resubmit from the current status. Both `submit`
 * (from draft) and `resubmit` (from changes_requested) target `submitted`. The
 * all-six-complete gate is enforced separately (`isSubmittable`). */
export function canCampSubmit(from: RegistrationStatus): boolean {
  return canTransitionRegistration(from, "submitted");
}

/** Whether the camp may withdraw from the current status. */
export function canCampWithdraw(from: RegistrationStatus): boolean {
  return canTransitionRegistration(from, "withdrawn");
}

/**
 * Resolve a camp action to its target status, asserting the transition against
 * the state machine (throws on an illegal move). `submit`/`resubmit` both go to
 * `submitted`; `withdraw` goes to `withdrawn`.
 */
export function resolveCampAction(
  from: RegistrationStatus,
  action: CampAction,
): RegistrationStatus {
  const target: RegistrationStatus =
    action === "withdraw" ? "withdrawn" : "submitted";
  return assertRegistrationTransition(from, target);
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

/**
 * Who may post a REPLY under a section review (design frames: the camp answering
 * the placement team). Server-side authz predicate — the app resolves the two
 * facts and this decides. A reply is allowed when the caller is a member of the
 * camp under review (ANY role — a member can answer, not only leads) OR is org
 * staff (god / org_staff). Pure so the rule is one implementation, tested without
 * a DB. The UI is built by a later agent; this is the boundary check it relies on.
 */
export function canReplyToSectionReview(ctx: {
  /** The caller's membership role on the camp under review, or null if none. */
  campRole: MembershipRole | null;
  /** Whether the caller is org staff (god or org_staff). */
  isOrgStaff: boolean;
}): boolean {
  return ctx.campRole !== null || ctx.isOrgStaff;
}

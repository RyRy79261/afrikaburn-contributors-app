// Pure, framework-agnostic logic for the organiser console: review-action
// resolution (built on @quagga/core's registration state machine), the
// new-vs-returning cohort derivation, and sound-level classification for the
// registrations filter. No I/O, no React, no server-only — unit-tested in
// __tests__/org-logic.test.ts.

import {
  canTransitionRegistration,
  assertRegistrationTransition,
} from "@quagga/core";
import type { RegistrationStatus } from "@quagga/types";

// --- Review actions ------------------------------------------------------
// The console exposes four reviewer actions. Each maps to a target status; the
// legal path to that status is computed against the core state machine so an
// illegal action (e.g. approving a draft) throws rather than corrupting state.

export const REVIEW_ACTIONS = [
  "start_review",
  "approve",
  "request_changes",
  "reject",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Target status each reviewer action drives the registration toward. */
export const REVIEW_ACTION_TARGET: Record<ReviewAction, RegistrationStatus> = {
  start_review: "under_review",
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
};

/** Human labels for the reviewer actions. */
export const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  start_review: "Start review",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
};

/**
 * Resolve the sequence of legal transitions that applies `action` to a
 * registration currently in `from`. Prefers a direct transition; otherwise
 * routes through `under_review` (so a reviewer can approve/reject a freshly
 * `submitted` registration in one step). Throws if no legal path exists.
 *
 * Returns the ordered list of intermediate + final statuses (never empty).
 */
export function resolveReviewActionPath(
  from: RegistrationStatus,
  action: ReviewAction,
): RegistrationStatus[] {
  const target = REVIEW_ACTION_TARGET[action];

  if (from === target) {
    throw new Error(`Registration is already ${target}.`);
  }

  // Direct legal transition.
  if (canTransitionRegistration(from, target)) {
    return [target];
  }

  // Route via under_review (submitted → under_review → approved/rejected/…).
  if (
    target !== "under_review" &&
    canTransitionRegistration(from, "under_review") &&
    canTransitionRegistration("under_review", target)
  ) {
    return ["under_review", target];
  }

  throw new Error(
    `Cannot ${action.replace("_", " ")} a registration in "${from}" state.`,
  );
}

/**
 * Validate a full review action and return its final status. Asserts every
 * step of the path through the core state machine (defence in depth).
 */
export function resolveReviewAction(
  from: RegistrationStatus,
  action: ReviewAction,
): RegistrationStatus {
  const path = resolveReviewActionPath(from, action);
  let cursor = from;
  for (const next of path) {
    assertRegistrationTransition(cursor, next);
    cursor = next;
  }
  return cursor;
}

/** Whether a reviewer action is currently offered for a given status. */
export function isReviewActionAvailable(
  from: RegistrationStatus,
  action: ReviewAction,
): boolean {
  try {
    resolveReviewActionPath(from, action);
    return true;
  } catch {
    return false;
  }
}

/** The reviewer actions offered for a registration in `from`. */
export function availableReviewActions(
  from: RegistrationStatus,
): ReviewAction[] {
  return REVIEW_ACTIONS.filter((a) => isReviewActionAvailable(from, a));
}

// --- New vs returning ----------------------------------------------------
// A project is "returning" iff it registered in an edition PRIOR to the one
// under review — derived, never stored. Callers pass whether any prior-edition
// registration exists for the group.

export type Cohort = "new" | "returning";

/** Derive the cohort from the presence of a prior-edition registration. */
export function deriveCohort(hasPriorRegistration: boolean): Cohort {
  return hasPriorRegistration ? "returning" : "new";
}

// --- Sound-level classification -----------------------------------------
// Section 5 stores amplified-music preference as free-ish text (e.g. "Level 2
// — car stereo", "No amplified sound"). The filter buckets it into a small set
// so reviewers can slice the table by noise.

export const SOUND_LEVELS = [
  "none",
  "level_1",
  "level_2",
  "level_3",
  "level_4",
  "unspecified",
] as const;
export type SoundLevel = (typeof SOUND_LEVELS)[number];

export const SOUND_LEVEL_LABELS: Record<SoundLevel, string> = {
  none: "No amplified sound",
  level_1: "Level 1 — ambient",
  level_2: "Level 2 — car stereo",
  level_3: "Level 3 — small rig",
  level_4: "Level 4 — large rig",
  unspecified: "Unspecified",
};

/**
 * Classify a stored amplified-music string into a sound-level bucket. Matches a
 * digit 1–4 anywhere in the string first; falls back to "none" for explicit
 * no-sound phrasing, and "unspecified" when empty/unknown.
 */
export function classifySoundLevel(raw: string | null | undefined): SoundLevel {
  if (raw == null || raw.trim() === "") return "unspecified";
  const text = raw.toLowerCase();

  const digit = text.match(/[1-4]/);
  if (digit) {
    return `level_${digit[0]}` as SoundLevel;
  }

  if (/\b(no|none|silent|zero)\b/.test(text) || text.includes("no amplif")) {
    return "none";
  }

  return "unspecified";
}

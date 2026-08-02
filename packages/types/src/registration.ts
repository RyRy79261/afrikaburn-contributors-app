import { z } from "zod";

/**
 * Registration lifecycle (`registrations.status`). A project is "registered"
 * for an edition iff an `approved` row exists — that predicate lives in
 * @quagga/core (`isRegistered`). Legal transitions are enforced by the state
 * machine in @quagga/core.
 *
 * Keep in sync with `registrationStatusEnum` in @quagga/db schema.ts.
 */
export const RegistrationStatus = z.enum([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
]);
export type RegistrationStatus = z.infer<typeof RegistrationStatus>;

/**
 * The six registration sections. These keys index both the wizard steps and
 * per-section review threads.
 *
 * ALL SIX STILL EXIST. What changed with Form 2 (roadmap M4-20) is WHEN each is
 * answered and which of them gate submission — see FORM_1_SECTION_KEYS below.
 * The keys, the review threads and the typed columns behind them are untouched,
 * because a section answered in January is the same section a reviewer reads.
 *
 * Keep in sync with `sectionKeyEnum` in @quagga/db schema.ts.
 */
export const SectionKey = z.enum([
  "identity", // 1 — camp identity + contact
  "lnt", // 2 — Leave No Trace incl. LNT lead contact
  "participation", // 3 — participation & gifting
  "size_logistics", // 4 — size & logistics incl. layout uploads
  "sound_placement", // 5 — sound & placement preferences
  "suppliers_commerce", // 6 — suppliers & commerce
]);
export type SectionKey = z.infer<typeof SectionKey>;

/** All six section keys, in wizard order. */
export const SECTION_KEYS: readonly SectionKey[] = [
  "identity",
  "lnt",
  "participation",
  "size_logistics",
  "sound_placement",
  "suppliers_commerce",
];

/**
 * THE TWO-FORM SPLIT (roadmap M4-20, docs/synthesis.md §"Form 1 / Form 2").
 *
 * AfrikaBurn does not run one registration form; it runs two, months apart:
 *
 *   FORM 1 (opens ~September) — "state your grand intentions". Who you are, what
 *   you are bringing, how you will leave no trace, what you are selling. The
 *   Theme Camp Committee reviews these biweekly and approves or comes back with
 *   suggestions. Approval is what makes a camp registered.
 *
 *   FORM 2 (January) — "the other stuff". How big you are, where you want to be,
 *   what noise you will make, and the mandatory layout diagram. Nobody knows any
 *   of this in September, which is exactly why AfrikaBurn asks later.
 *
 * SO THE SUBMIT GATE IS FORM 1's, NOT ALL SIX. Requiring a September applicant
 * to declare their January answers is not a stricter form — it is an
 * unanswerable one, and it would have blocked the entire registration season.
 * `isSubmittable` in @quagga/core gates on FORM_1_SECTION_KEYS for that reason.
 *
 * Form 2 ships as an org QUESTIONNAIRE targeting `registered_camp_leads`, so
 * AfrikaBurn can author and release it without a deploy. Its answers are mirrored
 * back into the same registration columns the wizard writes, so everything
 * downstream — the officer requirements derived from the sound answer, the
 * review screen, the camp's own summary — reads one source and cannot tell the
 * difference.
 */
export const FORM_1_SECTION_KEYS: readonly SectionKey[] = [
  "identity",
  "lnt",
  "participation",
  "suppliers_commerce",
];

/**
 * The sections Form 2 asks. `size_logistics` already carries the layout uploads,
 * which is the diagram AfrikaBurn calls mandatory at Form 2.
 *
 * Gifting stays in Form 1 despite living under AfrikaBurn's Form-2 heading:
 * ours sits inside the participation section, and what you intend to gift IS
 * your grand intention. Splitting section 3 across two forms would mean one
 * review thread whose two halves are answered five months apart.
 */
export const FORM_2_SECTION_KEYS: readonly SectionKey[] = [
  "size_logistics",
  "sound_placement",
];

/** Which form a section belongs to. */
export function formForSection(key: SectionKey): 1 | 2 {
  return FORM_2_SECTION_KEYS.includes(key) ? 2 : 1;
}

/** Human labels for the six sections. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  identity: "Camp Identity",
  lnt: "Leave No Trace",
  participation: "Participation & Gifting",
  size_logistics: "Size & Logistics",
  sound_placement: "Sound & Placement",
  suppliers_commerce: "Suppliers & Commerce",
};

/**
 * Per-section AB feedback thread state (`section_reviews.status`).
 * Keep in sync with `sectionReviewStatusEnum` in @quagga/db schema.ts.
 */
export const SectionReviewStatus = z.enum(["open", "resolved"]);
export type SectionReviewStatus = z.infer<typeof SectionReviewStatus>;

/** Operating-hours multi-select (Section 3). */
export const OperatingHours = z.enum(["morning", "day", "night", "late_night"]);
export type OperatingHours = z.infer<typeof OperatingHours>;

/** Max number of layout images a camp may upload (Section 4). */
export const MAX_LAYOUT_UPLOADS = 4;

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
 * per-section review threads. A registration is submittable only when all six
 * are complete (`isSubmittable` in @quagga/core).
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

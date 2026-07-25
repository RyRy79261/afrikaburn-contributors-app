import { z } from "zod";

// Supplier model v2 (docs/supplier-spec.md). The old `vetting_status`
// (listed/registered/flagged) and `source` (ab_sheet/manual) vocabularies are
// DEAD — replaced by org-set `standing`, a derived onboarding checklist, and an
// org-internal notes timeline. Keep every enum here in sync with the matching
// pgEnum / jsonb `$type` in @quagga/db schema.ts.

/**
 * Supplier standing (`suppliers.standing`) — the org's single verdict on a
 * supplier, visible everywhere the supplier appears (org console + camp-side
 * picker). The three-value v2 vocabulary is extended with the positive grades
 * from AfrikaBurn's supplier grading vocabulary (the sheet's "Diligent First
 * Timer" / "Able & Willing To Adapt", plus "Absolute Beginners" from the
 * afrikaburn.org suppliers policy) so imported Status values map 1:1.
 * - `good`                 — in good standing; renders normally in the picker.
 * - `watch`                — a subtle caution; still pickable, flagged for attention.
 * - `suspended`            — excluded from the camp-side picker entirely.
 * - `diligent_first_timer` — a newbie doing everything right (sheet "Diligent
 *   First Timer"). Positive: pickable, no caution.
 * - `adapting`             — "Able & Willing To Adapt". Positive: pickable, no
 *   caution.
 * - `absolute_beginner`    — a brand-new supplier in their first cycle (policy
 *   "Absolute Beginners"). Positive: pickable, no caution.
 */
export const SupplierStanding = z.enum([
  "good",
  "watch",
  "suspended",
  "diligent_first_timer",
  "adapting",
  "absolute_beginner",
]);
export type SupplierStanding = z.infer<typeof SupplierStanding>;

/**
 * Whether a supplier is returning or brand-new (`suppliers.returning`, from the
 * sheet's "Returning Supplier?" column: `Yes` → `returning`, `Newbie` →
 * `newbie`). Nullable in storage — imported rows with a blank cell carry none.
 */
export const SupplierReturning = z.enum(["newbie", "returning"]);
export type SupplierReturning = z.infer<typeof SupplierReturning>;

/**
 * The seven onboarding step keys, in procedure order, from the real Supplier
 * Depot process (docs/sources/quaggapedia/supplier-depot.md). Per supplier ×
 * edition. The catalog (titles, ownership, confirmation semantics) lives in
 * @quagga/core `SUPPLIER_ONBOARDING_STEPS`.
 */
export const SUPPLIER_ONBOARDING_STEP_KEYS = [
  "registration_form",
  "agreement_signed",
  "deposit_paid",
  "inventory_submitted",
  "crew_details_submitted",
  "briefing_attended",
  "registration_fee_paid",
] as const;

export const SupplierOnboardingStepKey = z.enum(SUPPLIER_ONBOARDING_STEP_KEYS);
export type SupplierOnboardingStepKey = z.infer<typeof SupplierOnboardingStepKey>;

/**
 * Per-step status stored in `supplier_onboarding.steps` (jsonb).
 * - `pending`               — not started.
 * - `awaiting_confirmation` — the supplier has done their part; AfrikaBurn must
 *   review/confirm (used by the org-reviewed steps 4/5, and shown to suppliers
 *   as "awaiting AfrikaBurn confirmation").
 * - `completed`             — done.
 */
export const SupplierOnboardingStepStatus = z.enum([
  "pending",
  "awaiting_confirmation",
  "completed",
]);
export type SupplierOnboardingStepStatus = z.infer<
  typeof SupplierOnboardingStepStatus
>;

/**
 * The stored step-state map (`supplier_onboarding.steps`). Partial by design:
 * a missing key is treated as `pending` by the derivation in @quagga/core, so
 * fresh rows can start as `{}`.
 */
export type SupplierOnboardingSteps = Partial<
  Record<SupplierOnboardingStepKey, SupplierOnboardingStepStatus>
>;

/**
 * Lenient validator for the stored step map. Keyed by string (partial /
 * open-ended on purpose) so a `{}` or partially-filled row round-trips; the
 * derivation in @quagga/core is the authority on which keys matter.
 */
export const SupplierOnboardingSteps = z
  .record(z.string(), SupplierOnboardingStepStatus)
  .transform((m) => m as SupplierOnboardingSteps);

/**
 * Supplier note kind (`supplier_notes.kind`) — the org-internal timeline entry
 * type. Never visible to suppliers or camps.
 * - `infraction` — a recorded breach (🔴).
 * - `blessing`   — positive record / commendation (🟢).
 * - `note`       — neutral internal note (⚪).
 */
export const SupplierNoteKind = z.enum(["infraction", "blessing", "note"]);
export type SupplierNoteKind = z.infer<typeof SupplierNoteKind>;

/**
 * Shape of a single supplier as parsed from the AB public sheet CSV/JSON
 * snapshot. The import parser (@quagga/core `parseSuppliersCsv`) normalises
 * rows into this. Parser v2 ports the sheet's REAL columns: the `Status` column
 * maps to `standing`, `Category` is normalised, `Returning Supplier?` maps to
 * `returning`, and the fees/crew-pass progress phrases pre-populate an
 * `onboarding` step-state map (a phrase marked TRUE → its step `completed`).
 * Contact-column phone numbers and addresses are still scrubbed at parse time;
 * only business name, contact-person name, and business email remain.
 */
export const SupplierImportRow = z.object({
  name: z.string().min(1),
  services: z.string().default(""),
  contact: z.string().default(""),
  website: z.string().default(""),
  /** Normalised category chip (Transportation→Transport, FIREWOOD DELIVERY→
   * Firewood Delivery, title-cased; multiple joined with " / "). */
  category: z.string().default(""),
  /** From "Returning Supplier?" — nullable when the sheet cell is blank. */
  returning: SupplierReturning.nullable().default(null),
  /** Mapped from the sheet "Status" column; defaults to `good` when blank. */
  standing: SupplierStanding.default("good"),
  /** Onboarding steps pre-populated from the fees/crew-pass progress phrases. */
  onboarding: SupplierOnboardingSteps.default({}),
});
export type SupplierImportRow = z.infer<typeof SupplierImportRow>;

// --- Supplier documents (org-controlled) ---------------------------------
// docs/accounts-security-spec.md §"Supplier documents — org-controlled".
// The org CRUDs a per-edition list of documents/links suppliers must read; a
// `required_ack` document carries an acknowledgement checkbox on the supplier
// portal, and may BIND to an onboarding step (e.g. the Supplier Agreement binds
// to `agreement_signed`) so acknowledging it completes that step.

/**
 * Where a supplier document lives (`supplier_documents.source_type`).
 * - `link` — an external URL (a Google Doc, the afrikaburn.org policy page).
 * - `file` — an uploaded asset (Blob); `url` holds the blob URL either way, so
 *   the two differ only in how the UI labels the action (Open vs Download) and
 *   in who is responsible for the artifact's lifetime.
 */
export const SupplierDocumentSourceType = z.enum(["file", "link"]);
export type SupplierDocumentSourceType = z.infer<
  typeof SupplierDocumentSourceType
>;

/**
 * Org-side create/update payload for a supplier document. `stepKey` is the
 * optional binding to an onboarding step — when set AND `requiredAck` is true,
 * acknowledging every document bound to that step completes it for the supplier
 * (@quagga/core `applyDocumentAcksToSteps`). Binding a document to an
 * ORG-CONFIRMED step (deposit / briefing / fee) is rejected in core: a supplier
 * ticking a checkbox must never be able to confirm money or attendance.
 */
export const SupplierDocumentInput = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(160),
  sourceType: SupplierDocumentSourceType,
  url: z.string().trim().url("That doesn't look like a valid link.").max(2048),
  requiredAck: z.boolean().default(false),
  stepKey: SupplierOnboardingStepKey.nullable().default(null),
  sort: z.number().int().min(0).max(9999).nullable().default(null),
});
export type SupplierDocumentInput = z.infer<typeof SupplierDocumentInput>;

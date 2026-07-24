import { z } from "zod";

// Supplier model v2 (docs/supplier-spec.md). The old `vetting_status`
// (listed/registered/flagged) and `source` (ab_sheet/manual) vocabularies are
// DEAD — replaced by org-set `standing`, a derived onboarding checklist, and an
// org-internal notes timeline. Keep every enum here in sync with the matching
// pgEnum / jsonb `$type` in @quagga/db schema.ts.

/**
 * Supplier standing (`suppliers.standing`) — the org's single verdict on a
 * supplier, visible everywhere the supplier appears (org console + camp-side
 * picker).
 * - `good`      — in good standing; renders normally in the picker.
 * - `watch`     — a subtle caution; still pickable, flagged for attention.
 * - `suspended` — excluded from the camp-side picker entirely.
 */
export const SupplierStanding = z.enum(["good", "watch", "suspended"]);
export type SupplierStanding = z.infer<typeof SupplierStanding>;

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
 * rows into this. Standing is NOT part of the import shape — it is org-set and
 * defaults to `good` on seed/import (imported suppliers are simply listed, not
 * judged). Contact-column phone numbers and addresses are scrubbed at parse
 * time; only business name, contact-person name, and business email remain.
 */
export const SupplierImportRow = z.object({
  name: z.string().min(1),
  services: z.string().default(""),
  contact: z.string().default(""),
  website: z.string().default(""),
});
export type SupplierImportRow = z.infer<typeof SupplierImportRow>;

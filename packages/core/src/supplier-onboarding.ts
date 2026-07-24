// Supplier onboarding checklist (docs/supplier-spec.md §"Onboarding
// checklist"). The seven steps come from the real Supplier Depot registration
// procedure (docs/sources/quaggapedia/supplier-depot.md). This module is the
// code catalog + the pure derivations over a stored step-state map:
//   - SUPPLIER_ONBOARDING_STEPS: the ordered catalog with completes/confirms
//     metadata and Quaggapedia-derived inline content;
//   - deriveOnboardingProgress: n/7 + isOnboarded;
//   - validateStepTransition / applyStepTransition: the self-service vs
//     org-confirmed rule — a supplier can NEVER flip an org-confirmed step.
//
// Pure logic only — no I/O, no DB. The store persists the `steps` jsonb map;
// this decides what a given actor is allowed to do to it.

import type {
  SupplierOnboardingStepKey,
  SupplierOnboardingStepStatus,
  SupplierOnboardingSteps,
} from "@quagga/types";
import { SUPPLIER_ONBOARDING_STEP_KEYS } from "@quagga/types";

/** Who may drive a step. `—` in the spec (org does everything) maps to `org`. */
export type SupplierStepActor = "supplier" | "org";

/**
 * How a step reaches `completed` after the completing party acts (the spec's
 * "Who confirms" column):
 * - `auto`          — no confirmation; the supplier's action completes it.
 * - `org_may_revoke`— supplier self-completes; the org may later revoke it.
 * - `org_reviews`   — supplier submits (→ awaiting_confirmation); the org
 *                     reviews to complete.
 * - `org_confirms`  — org confirms outright; the supplier cannot touch it.
 */
export type SupplierStepConfirmation =
  | "auto"
  | "org_may_revoke"
  | "org_reviews"
  | "org_confirms";

/** How the supplier side may interact with a step (drives UI + transitions). */
export type SupplierStepFlow = "self_service" | "org_reviewed" | "org_confirmed";

export interface SupplierOnboardingStep {
  key: SupplierOnboardingStepKey;
  /** 1-based procedure order. */
  order: number;
  title: string;
  /** Corpus-grounded inline content — the rule surfaced where it's acted on. */
  description: string;
  /** The spec's "Who completes" column. */
  completedBy: SupplierStepActor;
  /** The spec's "Who confirms" column. */
  confirmation: SupplierStepConfirmation;
}

/**
 * The catalog. Order + metadata straight from the spec's onboarding table.
 * Edition-scoped overrides can layer on later; this is the default procedure.
 */
export const SUPPLIER_ONBOARDING_STEPS: readonly SupplierOnboardingStep[] = [
  {
    key: "registration_form",
    order: 1,
    title: "Registration form",
    description:
      "Register as a supplier via the AfrikaBurn Supplier Registration Form (or email suppliers@afrikaburn.com). Only registered creative projects may use suppliers, and every supplier must appear on the official Suppliers List. Deadline: the Friday before the event.",
    completedBy: "supplier",
    confirmation: "auto",
  },
  {
    key: "agreement_signed",
    order: 2,
    title: "Supplier agreement signed",
    description:
      "Read and sign the Supplier Agreement. Your name only appears on the official suppliers list once the agreement is signed and your deposit is paid. Adherence to the agreement is what earns your deposit refund.",
    completedBy: "supplier",
    confirmation: "org_may_revoke",
  },
  {
    key: "deposit_paid",
    order: 3,
    title: "Deposit received",
    description:
      "Pay your supplier deposit. AfrikaBurn confirms receipt here — the platform never processes or holds funds. The deposit is refunded on full compliance with the Supplier Agreement.",
    completedBy: "org",
    confirmation: "org_confirms",
  },
  {
    key: "inventory_submitted",
    order: 4,
    title: "Delivery inventory submitted",
    description:
      "Submit your delivery inventory on the Google Sheet provided by the Supplier Team. AfrikaBurn validates project codes; deliveries require prior approval and pre-submitted inventory. All suppliers operate only from the Supplier Depot.",
    completedBy: "supplier",
    confirmation: "org_reviews",
  },
  {
    key: "crew_details_submitted",
    order: 5,
    title: "Crew details submitted",
    description:
      "Submit names, IDs, and tickets for any crew who need site access. Participants must accompany suppliers during setup or drop-off.",
    completedBy: "supplier",
    confirmation: "org_reviews",
  },
  {
    key: "briefing_attended",
    order: 6,
    title: "Supplier briefing attended",
    description:
      "Attend the compulsory Supplier Briefing — individual meetings are arranged. AfrikaBurn confirms attendance.",
    completedBy: "org",
    confirmation: "org_confirms",
  },
  {
    key: "registration_fee_paid",
    order: 7,
    title: "Registration fee received",
    description:
      "Pay the registration fee (determined after approval) before arrival. AfrikaBurn confirms receipt — tracked only, never processed. Late or unregistered deliveries are denied entry; deliveries are allowed until the Sunday before gate.",
    completedBy: "org",
    confirmation: "org_confirms",
  },
];

/** Total number of onboarding steps (the `/7` denominator). */
export const SUPPLIER_ONBOARDING_STEP_COUNT = SUPPLIER_ONBOARDING_STEPS.length;

const STEP_BY_KEY: ReadonlyMap<SupplierOnboardingStepKey, SupplierOnboardingStep> =
  new Map(SUPPLIER_ONBOARDING_STEPS.map((s) => [s.key, s]));

/** Catalog entry for a key, or undefined for an unknown key. */
export function supplierOnboardingStep(
  key: SupplierOnboardingStepKey,
): SupplierOnboardingStep | undefined {
  return STEP_BY_KEY.get(key);
}

/** The interaction flow for a step (self-service / org-reviewed / org-confirmed). */
export function stepFlow(step: SupplierOnboardingStep): SupplierStepFlow {
  switch (step.confirmation) {
    case "auto":
    case "org_may_revoke":
      return "self_service";
    case "org_reviews":
      return "org_reviewed";
    case "org_confirms":
      return "org_confirmed";
  }
}

/** True when the supplier can independently drive the step to `completed`. */
export function isSelfServiceStep(step: SupplierOnboardingStep): boolean {
  return stepFlow(step) === "self_service";
}

/**
 * True when the org is the ONLY party that may complete the step (deposit,
 * briefing, fee). A supplier can never flip these.
 */
export function isOrgConfirmedStep(step: SupplierOnboardingStep): boolean {
  return stepFlow(step) === "org_confirmed";
}

/** True when the supplier submits but the org must review to complete (4/5). */
export function isOrgReviewedStep(step: SupplierOnboardingStep): boolean {
  return stepFlow(step) === "org_reviewed";
}

// --- Progress derivation --------------------------------------------------

export interface SupplierOnboardingStepView {
  step: SupplierOnboardingStep;
  status: SupplierOnboardingStepStatus;
}

export interface SupplierOnboardingProgress {
  /** Steps in `completed` status. */
  completed: number;
  /** Always SUPPLIER_ONBOARDING_STEP_COUNT (7). */
  total: number;
  /** True iff every step is `completed` — "onboarded properly". */
  isOnboarded: boolean;
  /** Steps the supplier has actioned but the org hasn't confirmed yet. */
  awaiting: number;
  /** Every step in catalog order with its resolved status. */
  steps: SupplierOnboardingStepView[];
}

/** Resolve the status of one step from a (possibly partial) stored map. */
export function stepStatus(
  states: SupplierOnboardingSteps | null | undefined,
  key: SupplierOnboardingStepKey,
): SupplierOnboardingStepStatus {
  return states?.[key] ?? "pending";
}

/**
 * Derive n/7 progress + `isOnboarded` from a stored step-state map. Missing
 * keys count as `pending`. Only `completed` counts toward the numerator.
 */
export function deriveOnboardingProgress(
  states: SupplierOnboardingSteps | null | undefined,
): SupplierOnboardingProgress {
  const steps: SupplierOnboardingStepView[] = SUPPLIER_ONBOARDING_STEPS.map(
    (step) => ({ step, status: stepStatus(states, step.key) }),
  );
  const completed = steps.filter((s) => s.status === "completed").length;
  const awaiting = steps.filter(
    (s) => s.status === "awaiting_confirmation",
  ).length;
  return {
    completed,
    total: SUPPLIER_ONBOARDING_STEP_COUNT,
    isOnboarded: completed === SUPPLIER_ONBOARDING_STEP_COUNT,
    awaiting,
    steps,
  };
}

/** A fresh, all-`pending` step map (every catalog key present). */
export function defaultOnboardingSteps(): SupplierOnboardingSteps {
  const out: SupplierOnboardingSteps = {};
  for (const key of SUPPLIER_ONBOARDING_STEP_KEYS) out[key] = "pending";
  return out;
}

// --- Transition validation ------------------------------------------------

export interface StepTransition {
  /** Who is attempting the change. */
  actor: SupplierStepActor;
  stepKey: SupplierOnboardingStepKey;
  from: SupplierOnboardingStepStatus;
  to: SupplierOnboardingStepStatus;
}

export type StepTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate a single step-state transition against the self-service vs
 * org-confirmed rules. The headline invariant: a supplier can NEVER move an
 * org-confirmed step (deposit / briefing / fee), and can never mark an
 * org-reviewed step (inventory / crew) `completed` — only `awaiting_confirmation`.
 *
 * Rules by flow:
 *   self_service  (1 registration_form, 2 agreement_signed)
 *     - supplier: pending ↔ completed
 *     - org:      pending ↔ completed (org may revoke)
 *   org_reviewed  (4 inventory_submitted, 5 crew_details_submitted)
 *     - supplier: pending ↔ awaiting_confirmation (submit / withdraw); NOT completed
 *     - org:      any status → any status (review to complete, or send back)
 *   org_confirmed (3 deposit_paid, 6 briefing_attended, 7 registration_fee_paid)
 *     - supplier: nothing at all
 *     - org:      pending ↔ completed
 */
export function validateStepTransition(t: StepTransition): StepTransitionResult {
  const step = STEP_BY_KEY.get(t.stepKey);
  if (!step) return { ok: false, reason: `Unknown step: ${t.stepKey}` };
  if (t.from === t.to) {
    return { ok: false, reason: "Step is already in that state." };
  }

  const flow = stepFlow(step);

  // Org may do anything sensible (it owns confirmation). Only forbid nonsensical
  // moves — none, since org drives every flow.
  if (t.actor === "org") return { ok: true };

  // Supplier path — the rule that matters.
  switch (flow) {
    case "self_service": {
      // Supplier flips between pending and completed only.
      const allowed =
        (t.from === "pending" && t.to === "completed") ||
        (t.from === "completed" && t.to === "pending");
      return allowed
        ? { ok: true }
        : {
            ok: false,
            reason: "A supplier can only mark this step done or not done.",
          };
    }
    case "org_reviewed": {
      if (t.to === "completed") {
        return {
          ok: false,
          reason:
            "AfrikaBurn must review and confirm this step — you can submit it, but not mark it complete.",
        };
      }
      const allowed =
        (t.from === "pending" && t.to === "awaiting_confirmation") ||
        (t.from === "awaiting_confirmation" && t.to === "pending");
      return allowed
        ? { ok: true }
        : {
            ok: false,
            reason: "You can only submit or withdraw this step for review.",
          };
    }
    case "org_confirmed":
      return {
        ok: false,
        reason: "Only AfrikaBurn can confirm this step.",
      };
  }
}

export type ApplyStepTransitionResult =
  | { ok: true; steps: SupplierOnboardingSteps }
  | { ok: false; reason: string };

/**
 * Validate + apply a supplier/org action to a stored step map, returning a NEW
 * map (never mutating the input). The `from` is read from the current map (a
 * missing key is `pending`), so callers pass only actor + step + target status.
 */
export function applyStepTransition(
  states: SupplierOnboardingSteps | null | undefined,
  actor: SupplierStepActor,
  stepKey: SupplierOnboardingStepKey,
  to: SupplierOnboardingStepStatus,
): ApplyStepTransitionResult {
  const from = stepStatus(states, stepKey);
  const result = validateStepTransition({ actor, stepKey, from, to });
  if (!result.ok) return result;
  return { ok: true, steps: { ...(states ?? {}), [stepKey]: to } };
}

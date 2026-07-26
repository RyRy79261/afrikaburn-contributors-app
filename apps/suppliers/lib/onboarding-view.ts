// Pure view-model helpers for the onboarding checklist. Turns a core
// SupplierOnboardingStepView (catalog entry + resolved status) into the
// display + interaction descriptor the checklist cards render. No I/O, no React
// — unit-tested in ./__tests__.

import {
  isOrgConfirmedStep,
  isOrgReviewedStep,
  isSelfServiceStep,
  stepFlow,
  type SupplierOnboardingStep,
  type SupplierOnboardingStepView,
  type SupplierStepFlow,
} from "@quagga/core";
import type { SupplierOnboardingStepStatus } from "@quagga/types";

export type StepStatusTone = "done" | "awaiting" | "pending";

/**
 * What the Progress panel's SUPPLIER CODE chip (canvas `D6Xsb`) should show —
 * or `null` when it must not render at all.
 *
 * `suppliers.code` is nullable: rows imported from the AB sheet predate the
 * issuance scheme and are backfilled lazily, so a real, signed-in supplier can
 * legitimately have no code yet. The honest answer then is NOTHING — no chip,
 * no em-dash, no "pending" placeholder. A greyed-out stand-in in a mono chip
 * reads as an identifier, and this identifier leaves the platform (depot gate
 * lists, delivery manifests), so implying one exists when it does not is worse
 * than silence.
 *
 * The stored value is passed through as-is once trimmed (never reformatted):
 * the code is a promise made off-platform, and the portal is a reader of it,
 * not an authority on it.
 */
export function supplierCodeChipValue(
  code: string | null | undefined,
): string | null {
  const trimmed = code?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The card eyebrow line, e.g. "Step 3 · Org confirms" (canvas Q4fye). Encodes
 * the who-completes / who-confirms model from the step's confirmation type so
 * suppliers see, at a glance, who drives each step:
 *   - auto           → "You complete · Auto-confirmed"
 *   - org_may_revoke → "You confirm · Org may revoke"
 *   - org_reviews    → "You submit · Org reviews"
 *   - org_confirms   → "Org confirms"
 */
export function stepEyebrow(step: SupplierOnboardingStep): string {
  const who = ((): string => {
    switch (step.confirmation) {
      case "auto":
        return "You complete · Auto-confirmed";
      case "org_may_revoke":
        return "You confirm · Org may revoke";
      case "org_reviews":
        return "You submit · Org reviews";
      case "org_confirms":
        return "Org confirms";
    }
  })();
  return `Step ${step.order} · ${who}`;
}

export interface StepCardModel {
  flow: SupplierStepFlow;
  status: SupplierOnboardingStepStatus;
  tone: StepStatusTone;
  /** Short label for the status badge. */
  statusLabel: string;
  /**
   * Whether the supplier has an action they can take right now. False for
   * org-confirmed steps always, and for org-reviewed steps once submitted (they
   * can still withdraw — see `secondaryAction`).
   */
  supplierActionable: boolean;
  /** The primary self-service action, when there is one. */
  primaryAction?: { label: string; to: SupplierOnboardingStepStatus };
  /** A secondary action (e.g. undo / withdraw a submission). */
  secondaryAction?: { label: string; to: SupplierOnboardingStepStatus };
}

function toneFor(status: SupplierOnboardingStepStatus): StepStatusTone {
  if (status === "completed") return "done";
  if (status === "awaiting_confirmation") return "awaiting";
  return "pending";
}

function statusLabelFor(
  status: SupplierOnboardingStepStatus,
  flow: SupplierStepFlow,
): string {
  if (status === "completed") return "Done";
  if (status === "awaiting_confirmation") {
    return "Awaiting AfrikaBurn confirmation";
  }
  // pending
  return flow === "org_confirmed" ? "Awaiting AfrikaBurn" : "To do";
}

/**
 * Build the card model for a single step. Encodes the interaction rules the
 * server action enforces, so the UI only ever offers legal moves:
 *   - self-service (registration_form, agreement_signed): mark done / undo;
 *   - org-reviewed (inventory, crew): submit for review / withdraw; never a
 *     "complete" button — only AfrikaBurn completes these;
 *   - org-confirmed (deposit, briefing, fee): no supplier action at all — the
 *     card shows "awaiting AfrikaBurn confirmation" while pending.
 */
export function buildStepCardModel(
  view: SupplierOnboardingStepView,
): StepCardModel {
  const { step, status } = view;
  const flow = stepFlow(step);
  const tone = toneFor(status);
  const statusLabel = statusLabelFor(status, flow);

  if (isOrgConfirmedStep(step)) {
    return { flow, status, tone, statusLabel, supplierActionable: false };
  }

  if (isSelfServiceStep(step)) {
    if (status === "completed") {
      return {
        flow,
        status,
        tone,
        statusLabel,
        supplierActionable: true,
        secondaryAction: { label: "Undo", to: "pending" },
      };
    }
    return {
      flow,
      status,
      tone,
      statusLabel,
      supplierActionable: true,
      primaryAction: { label: "Mark done", to: "completed" },
    };
  }

  // org-reviewed (inventory / crew)
  if (isOrgReviewedStep(step)) {
    if (status === "awaiting_confirmation") {
      return {
        flow,
        status,
        tone,
        statusLabel,
        supplierActionable: false,
        secondaryAction: { label: "Withdraw submission", to: "pending" },
      };
    }
    if (status === "completed") {
      // AfrikaBurn has completed it — nothing for the supplier to do.
      return { flow, status, tone, statusLabel, supplierActionable: false };
    }
    return {
      flow,
      status,
      tone,
      statusLabel,
      supplierActionable: true,
      primaryAction: { label: "Submit for review", to: "awaiting_confirmation" },
    };
  }

  return { flow, status, tone, statusLabel, supplierActionable: false };
}

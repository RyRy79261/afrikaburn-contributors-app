// Pure view-model helpers for the onboarding checklist. Turns a core
// SupplierOnboardingStepView (catalog entry + resolved status) into the
// display + interaction descriptor the checklist cards render. No I/O, no React
// — unit-tested in ./__tests__.

import {
  isOrgConfirmedStep,
  isOrgReviewedStep,
  isSelfServiceStep,
  stepFlow,
  type SupplierOnboardingStepView,
  type SupplierStepFlow,
} from "@quagga/core";
import type { SupplierOnboardingStepStatus } from "@quagga/types";

export type StepStatusTone = "done" | "awaiting" | "pending";

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

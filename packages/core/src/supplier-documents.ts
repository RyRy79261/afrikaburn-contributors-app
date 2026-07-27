// Supplier documents & acknowledgements (docs/accounts-security-spec.md
// §"Supplier documents — org-controlled").
//
// The org CRUDs a per-edition list of documents/links suppliers must read. A
// document may be `requiredAck` (carries an acknowledgement checkbox) and may
// BIND to an onboarding step via `stepKey` — e.g. the Supplier Agreement binds
// to `agreement_signed`, so acknowledging it completes that step.
//
// The load-bearing rule: an acknowledgement may only ever complete a
// SELF-SERVICE step. Binding a document to an org-confirmed step (deposit,
// briefing, registration fee) is rejected at validation time, because a supplier
// ticking a checkbox must never be able to confirm that money arrived or that
// they attended a briefing. `validateDocumentBinding` is where that is enforced,
// and `applyDocumentAcksToSteps` refuses it a second time at apply time — the
// same defence-in-depth `applyStepTransition` already uses.
//
// Pure logic only: no I/O, no DB.

import type {
  SupplierDocumentSourceType,
  SupplierOnboardingStepKey,
  SupplierOnboardingSteps,
} from "@quagga/types";
import {
  applyStepTransition,
  isSelfServiceStep,
  stepStatus,
  supplierOnboardingStep,
} from "./supplier-onboarding";

/** A document row as every consumer reads it. */
export interface SupplierDocument {
  id: string;
  title: string;
  sourceType: SupplierDocumentSourceType;
  url: string;
  requiredAck: boolean;
  /** The onboarding step this document gates, if any. */
  stepKey: SupplierOnboardingStepKey | null;
  sort: number;
}

/** One acknowledgement (a `supplier_document_acks` row). */
export interface SupplierDocumentAck {
  documentId: string;
  ackedAt: Date;
}

/** A document plus this supplier's acknowledgement state — the panel's model. */
export interface SupplierDocumentView {
  document: SupplierDocument;
  acked: boolean;
  ackedAt: Date | null;
  /** True when this document must be acknowledged and has not been. */
  outstanding: boolean;
}

// --- Ordering + views -----------------------------------------------------

/**
 * Catalog order: `sort` ascending, then title (case-insensitive) as a stable
 * tie-break so two documents sharing a sort value never swap places between
 * renders.
 */
export function sortDocuments(
  documents: readonly SupplierDocument[],
): SupplierDocument[] {
  return [...documents].sort(
    (a, b) =>
      a.sort - b.sort ||
      a.title.localeCompare(b.title, "en", { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

/** Join documents to a supplier's acknowledgements, in catalog order. */
export function buildDocumentViews(
  documents: readonly SupplierDocument[],
  acks: readonly SupplierDocumentAck[],
): SupplierDocumentView[] {
  const ackedAt = new Map(acks.map((a) => [a.documentId, a.ackedAt]));
  return sortDocuments(documents).map((document) => {
    const at = ackedAt.get(document.id) ?? null;
    return {
      document,
      acked: at != null,
      ackedAt: at,
      outstanding: document.requiredAck && at == null,
    };
  });
}

/** Documents bound to a given onboarding step, in catalog order. */
export function documentsForStep(
  documents: readonly SupplierDocument[],
  stepKey: SupplierOnboardingStepKey,
): SupplierDocument[] {
  return sortDocuments(documents.filter((d) => d.stepKey === stepKey));
}

/** Documents that carry an acknowledgement checkbox. */
export function requiredAckDocuments(
  documents: readonly SupplierDocument[],
): SupplierDocument[] {
  return sortDocuments(documents.filter((d) => d.requiredAck));
}

export interface DocumentAckProgress {
  /** Required documents acknowledged. */
  acked: number;
  /** Total required documents. */
  required: number;
  /** True when every required document is acknowledged (vacuously true at 0). */
  allAcknowledged: boolean;
  /** The required-but-unacknowledged documents. */
  outstanding: SupplierDocument[];
}

/** n/m acknowledgement progress over the REQUIRED documents only. */
export function deriveDocumentAckProgress(
  documents: readonly SupplierDocument[],
  acks: readonly SupplierDocumentAck[],
): DocumentAckProgress {
  const ackedIds = new Set(acks.map((a) => a.documentId));
  const required = requiredAckDocuments(documents);
  const outstanding = required.filter((d) => !ackedIds.has(d.id));
  return {
    acked: required.length - outstanding.length,
    required: required.length,
    allAcknowledged: outstanding.length === 0,
    outstanding,
  };
}

// --- Binding validation (org side) ----------------------------------------

export type DocumentBindingResult = { ok: true } | { ok: false; reason: string };

/**
 * May a document bind to `stepKey`? Null (no binding) is always fine.
 *
 * Rejected:
 *  - unknown step keys;
 *  - steps the supplier cannot self-service (deposit / briefing / fee) — an
 *    acknowledgement is the supplier's own action, and the supplier may never
 *    drive an org-confirmed step;
 *  - a binding on a document that carries no acknowledgement checkbox, which
 *    would be inert: nothing would ever trigger the step.
 */
export function validateDocumentBinding(
  stepKey: SupplierOnboardingStepKey | null | undefined,
  requiredAck: boolean,
): DocumentBindingResult {
  if (stepKey == null) return { ok: true };

  const step = supplierOnboardingStep(stepKey);
  if (!step) return { ok: false, reason: `Unknown onboarding step: ${stepKey}` };

  if (!isSelfServiceStep(step)) {
    return {
      ok: false,
      reason: `"${step.title}" is confirmed by AfrikaBurn, so a document acknowledgement can't complete it. Bind the document to a step the supplier completes themselves, or leave it unbound.`,
    };
  }
  if (!requiredAck) {
    return {
      ok: false,
      reason:
        "A document bound to an onboarding step must require acknowledgement — otherwise nothing would ever complete the step.",
    };
  }
  return { ok: true };
}

// --- Ack → step completion ------------------------------------------------

/** Which steps are fully satisfied by the current acknowledgements. */
export function satisfiedStepKeys(
  documents: readonly SupplierDocument[],
  acks: readonly SupplierDocumentAck[],
): SupplierOnboardingStepKey[] {
  const ackedIds = new Set(acks.map((a) => a.documentId));
  const byStep = new Map<SupplierOnboardingStepKey, SupplierDocument[]>();

  for (const doc of documents) {
    if (doc.stepKey == null || !doc.requiredAck) continue;
    const list = byStep.get(doc.stepKey);
    if (list) list.push(doc);
    else byStep.set(doc.stepKey, [doc]);
  }

  const satisfied: SupplierOnboardingStepKey[] = [];
  for (const [stepKey, docs] of byStep) {
    // A step with no bound documents is NOT satisfied here (it is simply not
    // driven by documents) — `byStep` only ever holds steps with ≥1 document.
    if (docs.every((d) => ackedIds.has(d.id))) satisfied.push(stepKey);
  }
  return satisfied;
}

/** True when every required document bound to `stepKey` is acknowledged. */
export function isStepSatisfiedByAcks(
  documents: readonly SupplierDocument[],
  acks: readonly SupplierDocumentAck[],
  stepKey: SupplierOnboardingStepKey,
): boolean {
  const bound = documents.filter(
    (d) => d.stepKey === stepKey && d.requiredAck,
  );
  if (bound.length === 0) return false;
  const ackedIds = new Set(acks.map((a) => a.documentId));
  return bound.every((d) => ackedIds.has(d.id));
}

export interface DocumentAckStepResult {
  /** The step map after applying every document-driven completion/reversal. */
  steps: SupplierOnboardingSteps;
  /** Steps this call moved to `completed`. */
  completed: SupplierOnboardingStepKey[];
  /** Steps this call moved back to `pending` (an ack was withdrawn). */
  reverted: SupplierOnboardingStepKey[];
}

/**
 * Reconcile a supplier's onboarding step map against their document
 * acknowledgements. Called after every ack/un-ack, and after the org edits the
 * document list (adding a new required document to a bound step correctly
 * re-opens that step).
 *
 * Both directions matter. Acknowledging the last outstanding document COMPLETES
 * the bound step; withdrawing an acknowledgement REVERTS it to pending — a step
 * that stayed green after its evidence was withdrawn would be a lie in the org's
 * console.
 *
 * Every move goes through `applyStepTransition` as the `supplier` actor, so the
 * org-confirmed guard applies here too even if a malformed binding somehow got
 * past `validateDocumentBinding`. A rejected transition is skipped silently
 * rather than throwing: reconciliation is a background consequence of an
 * unrelated user action, and it must never fail that action.
 */
export function applyDocumentAcksToSteps(
  states: SupplierOnboardingSteps | null | undefined,
  documents: readonly SupplierDocument[],
  acks: readonly SupplierDocumentAck[],
  /**
   * Extra steps to re-evaluate even though no document is bound to them any
   * more. Pass the step a document was bound to when the org DELETES or
   * REBINDS it.
   *
   * Without this the reconcile set is derived purely from the CURRENT document
   * list, so deleting the last required document bound to a step removed that
   * step from consideration entirely and left a stale `completed` in place
   * forever — the console reporting a supplier as signed for a document that no
   * longer exists (audit M17). A step with no bound documents is by definition
   * unsatisfied (`isStepSatisfiedByAcks` returns false on an empty binding), so
   * forcing it into the loop reverts it, which is the honest state.
   */
  alsoConsider: readonly SupplierOnboardingStepKey[] = [],
): DocumentAckStepResult {
  let steps: SupplierOnboardingSteps = { ...(states ?? {}) };
  const completed: SupplierOnboardingStepKey[] = [];
  const reverted: SupplierOnboardingStepKey[] = [];

  // Only steps that actually have bound required documents are reconciled —
  // steps driven by other means keep whatever state they hold.
  const boundSteps = new Set<SupplierOnboardingStepKey>(alsoConsider);
  for (const doc of documents) {
    if (doc.stepKey != null && doc.requiredAck) boundSteps.add(doc.stepKey);
  }

  for (const stepKey of boundSteps) {
    const step = supplierOnboardingStep(stepKey);
    if (!step || !isSelfServiceStep(step)) continue;

    const satisfied = isStepSatisfiedByAcks(documents, acks, stepKey);
    const current = stepStatus(steps, stepKey);

    if (satisfied && current !== "completed") {
      const result = applyStepTransition(steps, "supplier", stepKey, "completed");
      if (result.ok) {
        steps = result.steps;
        completed.push(stepKey);
      }
    } else if (!satisfied && current === "completed") {
      const result = applyStepTransition(steps, "supplier", stepKey, "pending");
      if (result.ok) {
        steps = result.steps;
        reverted.push(stepKey);
      }
    }
  }

  return { steps, completed, reverted };
}

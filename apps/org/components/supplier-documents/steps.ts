import {
  SUPPLIER_ONBOARDING_STEPS,
  isSelfServiceStep,
  supplierOnboardingStep,
} from "@quagga/core";
import type { SupplierOnboardingStepKey } from "@quagga/types";

// Which onboarding steps a document may BIND to, and how the console labels a
// binding. Derived from the @quagga/core catalog rather than hand-listed, so
// the picker can never drift from the rule the server enforces.
//
// THE RULE (docs/accounts-security-spec.md §"Binding rule", enforced in
// `validateDocumentBinding` and re-checked at apply time in
// `applyDocumentAcksToSteps`): a document may only bind to a step the SUPPLIER
// completes themselves. Org-confirmed steps (deposit, briefing, registration
// fee) and org-reviewed steps are excluded — a supplier ticking a checkbox must
// never be able to confirm that money arrived or that they attended a briefing.
// Filtering the picker is a courtesy, not the boundary: the action rejects a
// forged step key regardless.

export interface BindableStep {
  key: SupplierOnboardingStepKey;
  title: string;
}

/** The steps a document may bind to, in procedure order. */
export const BINDABLE_STEPS: readonly BindableStep[] =
  SUPPLIER_ONBOARDING_STEPS.filter(isSelfServiceStep).map((step) => ({
    key: step.key,
    title: step.title,
  }));

/**
 * Radix Select cannot carry an empty-string item value, so "no binding" travels
 * as this sentinel and is mapped back to `null` before it reaches the action.
 */
export const UNBOUND_VALUE = "__unbound__";

/**
 * Narrow a stored `step_key` (plain text in the database, mirroring the
 * `supplier_onboarding.steps` keys) to a catalog key. An unknown value — a
 * legacy row, or a key a future catalog change retired — becomes `null`
 * ("unbound") rather than being passed on to the action as a bogus binding.
 */
export function asStepKey(
  value: string | null | undefined,
): SupplierOnboardingStepKey | null {
  if (!value) return null;
  const step = supplierOnboardingStep(value as SupplierOnboardingStepKey);
  return step ? step.key : null;
}

/** Human label for a stored `step_key` (unknown keys degrade honestly). */
export function stepLabel(stepKey: string | null): string {
  if (!stepKey) return "Not bound";
  const step = supplierOnboardingStep(stepKey as SupplierOnboardingStepKey);
  return step?.title ?? `Unknown step (${stepKey})`;
}

// Supplier standing helpers + camp-side picker eligibility
// (docs/supplier-spec.md §"The supplier model" + §"Guardrails"). Standing is
// the org's single verdict; the camp-side picker keys off it (suspended
// excluded) plus onboarding completeness (incomplete suppliers are shown with
// an "onboarding incomplete" tag, not hidden). Pure logic — no I/O.

import type { SupplierStanding } from "@quagga/types";

/** Standing values in display/severity order. */
export const SUPPLIER_STANDINGS: readonly SupplierStanding[] = [
  "good",
  "watch",
  "suspended",
];

/** True for a suspended supplier — excluded from the camp-side picker. */
export function isSuspended(standing: SupplierStanding): boolean {
  return standing === "suspended";
}

/** True when a supplier should render with a subtle caution (watch). */
export function standingRequiresCaution(standing: SupplierStanding): boolean {
  return standing === "watch";
}

/** Short label for chips/badges. */
export function standingLabel(standing: SupplierStanding): string {
  switch (standing) {
    case "good":
      return "Good standing";
    case "watch":
      return "Watch";
    case "suspended":
      return "Suspended";
  }
}

/**
 * Plain-language description shown to the supplier themselves (they see their
 * OWN standing — the notes trail stays org-only).
 */
export function standingDescription(standing: SupplierStanding): string {
  switch (standing) {
    case "good":
      return "You're in good standing with AfrikaBurn.";
    case "watch":
      return "AfrikaBurn has flagged your account for attention. You can still be selected by creative projects — please get in touch with the Supplier Team.";
    case "suspended":
      return "Your account is suspended. You won't appear to creative projects until this is resolved — contact suppliers@afrikaburn.com.";
  }
}

/** The camp-side picker's tag vocabulary (rendered as chips on a supplier row). */
export type SupplierPickerTag = "onboarding_incomplete";

export interface SupplierPickerEligibility {
  /** False when suspended — the row is excluded from the picker entirely. */
  eligible: boolean;
  standing: SupplierStanding;
  /** True for `watch` — render a subtle caution. */
  caution: boolean;
  /** Whether the supplier has completed onboarding for the active edition. */
  onboardingComplete: boolean;
  /** Advisory tags shown next to an eligible row (e.g. "onboarding incomplete"). */
  tags: SupplierPickerTag[];
}

/**
 * Decide how a supplier appears in the camp-side picker. `suspended` → not
 * eligible (excluded). `watch` → eligible with caution. Incomplete onboarding →
 * eligible but tagged "onboarding_incomplete" (shown, not hidden).
 */
export function supplierPickerEligibility(input: {
  standing: SupplierStanding;
  isOnboarded: boolean;
}): SupplierPickerEligibility {
  const eligible = !isSuspended(input.standing);
  const tags: SupplierPickerTag[] = [];
  if (!input.isOnboarded) tags.push("onboarding_incomplete");
  return {
    eligible,
    standing: input.standing,
    caution: standingRequiresCaution(input.standing),
    onboardingComplete: input.isOnboarded,
    tags,
  };
}

/**
 * Filter a supplier list to the picker-eligible set (drops suspended), keeping
 * the eligibility descriptor alongside each surviving row.
 */
export function filterPickerEligible<
  T extends { standing: SupplierStanding; isOnboarded: boolean },
>(suppliers: readonly T[]): Array<T & { eligibility: SupplierPickerEligibility }> {
  const out: Array<T & { eligibility: SupplierPickerEligibility }> = [];
  for (const s of suppliers) {
    const eligibility = supplierPickerEligibility({
      standing: s.standing,
      isOnboarded: s.isOnboarded,
    });
    if (eligibility.eligible) out.push({ ...s, eligibility });
  }
  return out;
}

import type { RegistrationStatus, SectionKey } from "@quagga/types";
import { SECTION_KEYS } from "@quagga/types";

// Entitlement predicates (build-spec §Schema, §Core logic). The core rule:
// a project is "registered" for an edition IFF an APPROVED registration row
// exists for that (group, edition). Every entitlement derives from this.

/** Minimal shape `isRegistered` needs — pass the rows for one (group, edition). */
export interface RegistrationLike {
  status: RegistrationStatus;
}

/**
 * The entitlement predicate: true iff at least one of the given registrations
 * is `approved`. Callers pass the registration rows for a single group ×
 * edition (usually zero or one).
 */
export function isRegistered(
  registrations: readonly RegistrationLike[],
): boolean {
  return registrations.some((r) => r.status === "approved");
}

/** Whether a single registration row grants the "registered" attribute. */
export function isApprovedRegistration(
  registration: RegistrationLike | null | undefined,
): boolean {
  return registration?.status === "approved";
}

// --- Submit gate ---------------------------------------------------------
// A registration may be submitted only once ALL SIX sections are complete.
// `completedSections` is the `registrations.completed_sections` array.

/** True iff all six sections are present in `completedSections`. */
export function isSubmittable(completedSections: readonly string[]): boolean {
  const done = new Set(completedSections);
  return SECTION_KEYS.every((key) => done.has(key));
}

/** The sections still outstanding before a registration can be submitted. */
export function missingSections(
  completedSections: readonly string[],
): SectionKey[] {
  const done = new Set(completedSections);
  return SECTION_KEYS.filter((key) => !done.has(key));
}

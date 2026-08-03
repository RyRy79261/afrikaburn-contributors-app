import type { RegistrationStatus, SectionKey } from "@quagga/types";
import {
  FORM_1_SECTION_KEYS,
  FORM_2_SECTION_KEYS,
  SECTION_KEYS,
} from "@quagga/types";

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
// A registration may be submitted once its FORM 1 sections are complete.
// `completedSections` is the `registrations.completed_sections` array.
//
// IT USED TO BE ALL SIX, and that was wrong for the season this product opens
// in. AfrikaBurn's Form 1 opens in September and asks for intent; Form 2 opens
// in January and asks for size, placement, sound and the layout diagram. A camp
// applying in September does not know its January answers — that is the whole
// reason AfrikaBurn splits the form — so an all-six gate is not a stricter
// standard, it is an unanswerable one that would have held the entire
// registration season at "4 of 6 complete".
//
// The Form-2 sections are still real sections with real columns and real review
// threads. They are simply not this gate's business.

/** True iff every FORM 1 section is present in `completedSections`. */
export function isSubmittable(completedSections: readonly string[]): boolean {
  const done = new Set(completedSections);
  return FORM_1_SECTION_KEYS.every((key) => done.has(key));
}

/**
 * The sections still outstanding before a registration can be submitted.
 *
 * FORM 1 ONLY, deliberately: this drives the "still to do" list on the camp's
 * own wizard, and listing a section they cannot answer yet as outstanding is how
 * a form tells somebody they have failed at something that has not opened.
 * `missingForm2Sections` answers the other question separately.
 */
export function missingSections(
  completedSections: readonly string[],
): SectionKey[] {
  const done = new Set(completedSections);
  return FORM_1_SECTION_KEYS.filter((key) => !done.has(key));
}

/**
 * The Form-2 sections still outstanding — for the surfaces that legitimately
 * care once Form 2 has opened (the camp's own Form-2 prompt, and the org's view
 * of who has not returned theirs). Never part of the submit gate.
 */
export function missingForm2Sections(
  completedSections: readonly string[],
): SectionKey[] {
  const done = new Set(completedSections);
  return FORM_2_SECTION_KEYS.filter((key) => !done.has(key));
}

/** True once every section of BOTH forms is complete — the full picture a
 * reviewer eventually gets, and what placement needs before the burn. */
export function isFullyComplete(completedSections: readonly string[]): boolean {
  const done = new Set(completedSections);
  return SECTION_KEYS.every((key) => done.has(key));
}

// Burner-bio privacy hard-lock (build-spec §Schema `burner_bios`, §Core logic).
// Certain fields are ALWAYS private and their public/private flag can NEVER be
// set public, ever — enforced here, not in the UI.

/**
 * Field keys (as they appear in `burner_bios.privacy_flags`) that are locked
 * private. Maps the build-spec's classes: id_number → `saId`, passport_number →
 * `passport`, plus `phone`, both emergency contacts (on-site + off-site, each
 * split into name + phone), and `medical`.
 */
export const HARD_LOCKED_PRIVATE_FIELDS = [
  "saId",
  "passport",
  "phone",
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
  "medical",
] as const;

export type HardLockedField = (typeof HARD_LOCKED_PRIVATE_FIELDS)[number];

const HARD_LOCKED_SET: ReadonlySet<string> = new Set(
  HARD_LOCKED_PRIVATE_FIELDS,
);

/** True when a field is one of the always-private, never-public classes. */
export function isHardLockedPrivate(field: string): boolean {
  return HARD_LOCKED_SET.has(field);
}

/** True when a field is allowed to be made public at all. */
export function canBePublic(field: string): boolean {
  return !isHardLockedPrivate(field);
}

/**
 * Coerce a privacy-flags map to a safe state: every hard-locked field is forced
 * to `false` (private) regardless of what the caller supplied. This is the last
 * line before persistence — call it on every write of `privacy_flags`.
 */
export function enforcePrivacyFlags(
  flags: Record<string, boolean>,
): Record<string, boolean> {
  const safe: Record<string, boolean> = { ...flags };
  for (const field of HARD_LOCKED_PRIVATE_FIELDS) {
    safe[field] = false;
  }
  return safe;
}

/**
 * Return the hard-locked fields a caller illegally tried to set public. Empty
 * array ⇒ the input is already compliant. Use for a loud error at the boundary
 * before `enforcePrivacyFlags` silently corrects it.
 */
export function privacyViolations(
  flags: Record<string, boolean>,
): HardLockedField[] {
  return HARD_LOCKED_PRIVATE_FIELDS.filter((field) => flags[field] === true);
}

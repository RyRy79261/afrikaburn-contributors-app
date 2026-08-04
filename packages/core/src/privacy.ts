// Burner-bio privacy classes (build-spec §Schema `burner_bios`, §Core logic).
//
// Two classes of never-public field, both enforced HERE (never in the UI) and
// both unconditionally excluded from every public projection:
//
//  1. HARD_LOCKED_PRIVATE_FIELDS — absolutely private, NO access path, ever.
//     Phone, both emergency contacts, SA ID and passport. Nobody but the owner
//     sees these. The ONLY channel that shares a phone with the org is an
//     accepted officer registration (a separate consent flow), which never
//     touches these flags.
//
//  2. SAFETY_VISIBLE_FIELDS — never public either, but visible to the audience
//     the burner disclosed them to: their camp leads and AfrikaBurn's safety /
//     org staff. Medical notes only. The consent lives at the POINT OF ENTRY —
//     the field's own label in the Burner Bio states its audience plainly, which
//     is what makes the disclosure informed (exactly how AfrikaBurn already
//     handles medical info on paper). No reveal ceremony at read time: the
//     predicate lives in ./medical-access, the notes render on a member's DETAIL
//     view only (never a list or an export), stay encrypted at rest, and every
//     disclosing read is audited. This module only guarantees the field can
//     NEVER be made public.
//
// ALWAYS_PRIVATE_FIELDS is the union — the set that `canBePublic` refuses and
// `enforcePrivacyFlags` forces private. A safety-visible field is still 100%
// locked out of every public view; the class changes WHO may read it privately,
// never whether it can be published.
//
// (Ryan, 26 Jul 2026: medical moved out of the hard lock — "these would be
// similar to how burn currently manages medical data — if you disclose it,
// aren't you consenting to that audience to hold that data?" This supersedes the
// short-lived break-glass/reason-prompt design.)

/**
 * Fields (as keyed in `burner_bios.privacy_flags`) that are ABSOLUTELY private
 * with no access path of any kind: id_number → `saId`, passport_number →
 * `passport`, `phone`, and both emergency contacts (on-site + off-site, each
 * split into name + phone).
 */
export const HARD_LOCKED_PRIVATE_FIELDS = [
  "saId",
  "passport",
  "phone",
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
] as const;

export type HardLockedField = (typeof HARD_LOCKED_PRIVATE_FIELDS)[number];

/**
 * Fields that are never public but ARE visible to the audience the burner
 * consented to when they entered them — their camp leads and AfrikaBurn's
 * safety/org staff (see ./medical-access for the exact predicate). Currently
 * only medical notes.
 */
export const SAFETY_VISIBLE_FIELDS = ["medical"] as const;

export type SafetyVisibleField = (typeof SAFETY_VISIBLE_FIELDS)[number];

/**
 * The union of both classes: every field that can NEVER be made public,
 * whichever class it belongs to. This is what the public-projection gate and the
 * flag-enforcement helpers iterate — so adding either class to a public view is
 * impossible by construction.
 */
export const ALWAYS_PRIVATE_FIELDS = [
  ...HARD_LOCKED_PRIVATE_FIELDS,
  ...SAFETY_VISIBLE_FIELDS,
] as const;

export type AlwaysPrivateField = (typeof ALWAYS_PRIVATE_FIELDS)[number];

const HARD_LOCKED_SET: ReadonlySet<string> = new Set(
  HARD_LOCKED_PRIVATE_FIELDS,
);
const SAFETY_VISIBLE_SET: ReadonlySet<string> = new Set(SAFETY_VISIBLE_FIELDS);
const ALWAYS_PRIVATE_SET: ReadonlySet<string> = new Set(ALWAYS_PRIVATE_FIELDS);

/** True when a field is absolutely private with NO access path (class 1). */
export function isHardLockedPrivate(field: string): boolean {
  return HARD_LOCKED_SET.has(field);
}

/** True when a field is never-public but visible to the burner's camp leads and
 * AfrikaBurn safety staff (class 2). */
export function isSafetyVisibleField(field: string): boolean {
  return SAFETY_VISIBLE_SET.has(field);
}

/** True when a field can never be made public (either class). */
export function isAlwaysPrivate(field: string): boolean {
  return ALWAYS_PRIVATE_SET.has(field);
}

/** True when a field is allowed to be made public at all. */
export function canBePublic(field: string): boolean {
  return !isAlwaysPrivate(field);
}

/**
 * Coerce a privacy-flags map to a safe state: every always-private field (both
 * classes) is forced to `false` (private) regardless of what the caller
 * supplied. This is the last line before persistence — call it on every write of
 * `privacy_flags`. Safety-visible fields are forced private too: their audience
 * is decided at read time by the authz predicate, never by a stored "public" flag.
 */
export function enforcePrivacyFlags(
  flags: Record<string, boolean>,
): Record<string, boolean> {
  const safe: Record<string, boolean> = { ...flags };
  for (const field of ALWAYS_PRIVATE_FIELDS) {
    safe[field] = false;
  }
  return safe;
}

/**
 * Return the always-private fields a caller illegally tried to set public. Empty
 * array ⇒ the input is already compliant. Use for a loud error at the boundary
 * before `enforcePrivacyFlags` silently corrects it.
 */
export function privacyViolations(
  flags: Record<string, boolean>,
): AlwaysPrivateField[] {
  return ALWAYS_PRIVATE_FIELDS.filter((field) => flags[field] === true);
}

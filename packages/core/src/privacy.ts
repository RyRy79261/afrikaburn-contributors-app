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

// --- Three visibility levels (epic #68) -----------------------------------
//
// A field is now visible to one of THREE audiences:
//
//   private     — only the owner (plus whatever narrow, separately-authorised
//                 audience a class already has, e.g. medical's safety tier).
//   camp_mates  — the owner's camp-mates: people who share a theme-camp
//                 membership with them (see ./campmates for the predicate).
//   public      — anyone signed in who opens their profile.
//
// BACKWARD-COMPATIBLE STORAGE. `burner_bios.privacy_flags` has always been a
// `{ field: boolean }` map, and every row written before this change holds
// booleans. The encoding keeps that meaning EXACTLY and adds one value:
//
//   true          ⇒ public      (unchanged)
//   false         ⇒ private     (unchanged)
//   "camp_mates"  ⇒ camp_mates  (new)
//
// Public stays `true` and private stays `false` ON WRITE too (see
// `encodeFieldVisibility`), so a reader that only knows `=== true` — any code
// path this change missed, or this code after a rollback — reads a camp-mates
// field as PRIVATE. The unknown value fails closed, never open. Anything else
// found in the map (a typo, a string "public" from a hand edit, a number) is
// decoded by `readFieldVisibility`, which treats every unrecognised value as
// private for the same reason.

/** The three audiences a bio field may be shared with, narrowest first. */
export const FIELD_VISIBILITY_LEVELS = [
  "private",
  "camp_mates",
  "public",
] as const;

export type FieldVisibility = (typeof FIELD_VISIBILITY_LEVELS)[number];

/**
 * One stored value in `burner_bios.privacy_flags`. Booleans are the original
 * encoding (true = public, false = private); the level strings are accepted on
 * input, and `"camp_mates"` is the only string ever written.
 */
export type PrivacyFlagValue = boolean | FieldVisibility;

/** The whole stored map, keyed by field. */
export type PrivacyFlags = Record<string, PrivacyFlagValue>;

/**
 * Decode ONE stored value to its level. `true`/`"public"` ⇒ public,
 * `"camp_mates"` ⇒ camp_mates, and EVERYTHING else — false, undefined, null, a
 * typo — ⇒ private. Fail-closed by construction.
 */
export function readFieldVisibility(value: unknown): FieldVisibility {
  if (value === true || value === "public") return "public";
  if (value === "camp_mates") return "camp_mates";
  return "private";
}

/**
 * Encode a level for storage. Public and private keep their original boolean
 * spelling so every pre-existing reader (and a rollback) still reads them
 * correctly; only the new level is a string.
 */
export function encodeFieldVisibility(
  level: FieldVisibility,
): PrivacyFlagValue {
  if (level === "public") return true;
  if (level === "camp_mates") return "camp_mates";
  return false;
}

/** True when a field may be shared with camp-mates at all. The exclusions are
 * EXACTLY `canBePublic`'s: phone, both emergency contacts, SA ID, passport and
 * medical can never be camp-visible. Medical's audience (camp LEADS and org
 * safety staff) is decided by ./medical-access and is not "camp-mates" — a
 * fellow member is not in it. */
export function canBeCampVisible(field: string): boolean {
  return !isAlwaysPrivate(field);
}

/**
 * The EFFECTIVE level of one field: the stored level, clamped by the privacy
 * class. An always-private field is private whatever the map claims, so a
 * corrupted row can never widen it. Every read path goes through this.
 */
export function fieldVisibility(
  flags: Readonly<Record<string, unknown>>,
  field: string,
): FieldVisibility {
  if (isAlwaysPrivate(field)) return "private";
  return readFieldVisibility(flags[field]);
}

/** Visible to the owner's camp-mates? (camp_mates OR public, never a class
 * that can't be camp-visible.) */
export function isVisibleToCampMates(
  flags: Readonly<Record<string, unknown>>,
  field: string,
): boolean {
  if (!canBeCampVisible(field)) return false;
  const level = fieldVisibility(flags, field);
  return level === "camp_mates" || level === "public";
}

/** Visible to everyone? (public only, never an always-private field.) */
export function isVisibleToPublic(
  flags: Readonly<Record<string, unknown>>,
  field: string,
): boolean {
  return canBePublic(field) && fieldVisibility(flags, field) === "public";
}

/**
 * Coerce a privacy-flags map to a safe, CANONICAL state: every always-private
 * field (both classes) is forced to `false` (private) regardless of what the
 * caller supplied, and every other value is re-encoded through
 * `readFieldVisibility` → `encodeFieldVisibility`, so the stored map only ever
 * holds `true`, `false` or `"camp_mates"`. This is the last line before
 * persistence — call it on every write of `privacy_flags`. Safety-visible
 * fields are forced private too: their audience is decided at read time by the
 * authz predicate, never by a stored flag.
 */
export function enforcePrivacyFlags(
  flags: Readonly<Record<string, unknown>>,
): PrivacyFlags {
  const safe: PrivacyFlags = {};
  for (const [field, value] of Object.entries(flags)) {
    safe[field] = encodeFieldVisibility(readFieldVisibility(value));
  }
  for (const field of ALWAYS_PRIVATE_FIELDS) {
    safe[field] = false;
  }
  return safe;
}

/**
 * Return the always-private fields a caller illegally tried to widen — to
 * public OR to camp-mates. Empty array ⇒ the input is already compliant. Use
 * for a loud error at the boundary before `enforcePrivacyFlags` silently
 * corrects it.
 */
export function privacyViolations(
  flags: Readonly<Record<string, unknown>>,
): AlwaysPrivateField[] {
  return ALWAYS_PRIVATE_FIELDS.filter(
    (field) => readFieldVisibility(flags[field]) !== "private",
  );
}

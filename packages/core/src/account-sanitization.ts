// Account sanitization — the Camp 404 "Lost Cat" precedent.
//
// docs/accounts-security-spec.md §Deletion: deleting an account is NEVER a row
// delete. After the 14-day grace period we ERASE the person and KEEP the shape:
// every personal field is nulled or replaced with a stub, while `memberships`,
// `questionnaire_responses`, `required_actions`, `supplier_document_acks` and
// `audit_events` keep pointing at a row that still exists. POPIA erasure is
// satisfied (no personal information remains) without shredding a camp's roster,
// an edition's response set, or the audit trail that proves who did what.
//
// Why not `ON DELETE CASCADE`? Because the cascade is exactly the damage: a
// burner leaving would silently delete their camp's membership history, their
// answers to a questionnaire the org is still analysing, and the audit events
// recording approvals they made as a lead. Referential integrity is a safety
// property here, not a database nicety.
//
// This module is PURE: it computes the patches to apply. The app performs the
// writes. Keeping it pure is what lets the tests prove — without a database —
// that no personal field survives and no foreign key is touched.

import { ALWAYS_PRIVATE_FIELDS } from "./privacy";

/** What an anonymized account is called everywhere it still appears. */
export const DEPARTED_BURNER_NAME = "Departed Burner";

/**
 * Patch applied to the `users` row. The row itself SURVIVES — only its personal
 * content goes: `email` and `username` are nulled and `sanitizedAt` is stamped
 * (the tombstone the guards read).
 *
 * `username` is personal data — a self-chosen handle that people recognise
 * offline — so POPIA erasure takes it, and nulling it also FREES it for someone
 * else (the unique index treats NULLs as distinct). It is not replaced with a
 * stub: the stub would have to be unique per departed account, and a username
 * has a format. The stub is a RENDER concern instead — `publicMemberName` reads
 * the tombstone and shows "Departed Burner", so a roster keeps saying what
 * happened without the departed account still holding a handle.
 *
 * `authUserId` is DELIBERATELY LEFT UNCHANGED. It is the key the session
 * resolvers look the row up by (`ensureCampUser` / `resolveOrgSession` /
 * `resolveSupplierSession` all query `where authUserId = <Better Auth user id>`),
 * so the tombstone MUST stay findable by that id or the guard can never fire:
 * an earlier design rewrote it to `deleted:<uuid>`, which meant a returning
 * session (or a session still served from the 5-minute cookie cache after the
 * Better Auth identity was deleted) looked up by the real id found NOTHING and
 * was silently minted a fresh, clean account — the "Lost Cat" re-animation hole.
 *
 * The recycled-provider-id worry that motivated the rewrite does not apply to the
 * self-hosted stack: Better Auth mints random `user.id`s and account deletion
 * hard-deletes the identity row (so the id is never reissued). Even in an
 * impossible collision, `assertNotSanitized` REFUSES the sanitized row rather
 * than adopting it — the safe failure. Keeping the original id is therefore
 * strictly safer than rewriting it, and it is what makes the guard reachable.
 */
export interface UserSanitizationPatch {
  email: null;
  username: null;
  sanitizedAt: Date;
}

/**
 * Build the `users` patch. Nulls the email + username and stamps the tombstone;
 * leaves `authUserId` untouched so the row stays findable by the session
 * resolvers (see the interface note above).
 */
export function buildUserSanitizationPatch(
  _userId: string,
  at: Date,
): UserSanitizationPatch {
  return { email: null, username: null, sanitizedAt: at };
}

/**
 * Every personal column on `burner_bios`. Split into the fields that are nulled
 * outright and the one field that becomes the visible stub, so the test can
 * assert completeness against the schema rather than trusting this list by eye.
 *
 * The always-private classes (phone, both emergency contacts, SA ID, passport —
 * hard-locked — plus medical — safety-visible; see ./privacy) are all present by
 * construction: `assertBioPatchCovers` proves it, and the sanitization test fails
 * loudly if a future migration adds a personal column that nobody added here.
 * The safety-visible class changes who may READ medical notes on a live account;
 * it changes nothing about erasure — POPIA erasure still nulls the column.
 */
export const SANITIZED_BIO_NULL_FIELDS = [
  // Identity + self-description. `displayName` is the RETIRED per-edition playa
  // name (superseded by `users.username`): nothing writes it any more, but rows
  // created before the switch still hold a real one, so erasure still takes it.
  // It used to be stubbed with DEPARTED_BURNER_NAME so a roster rendered — that
  // job moved to `publicMemberName`, which reads the tombstone, so this column
  // can now be nulled outright (strictly more erasure).
  "displayName",
  "legalName",
  "homeCity",
  "bio",
  "about",
  // Contact
  "contactEmail",
  "phone",
  // Emergency contacts (hard-locked)
  "onsiteContactName",
  "onsiteContactPhone",
  "offsiteContactName",
  "offsiteContactPhone",
  // Medical (safety-visible — never public; still erased on deletion)
  "medicalNotes",
  // Government identifiers (hard-locked, pgcrypto-encrypted at rest)
  "saIdEncrypted",
  "passportEncrypted",
] as const;

export type SanitizedBioNullField = (typeof SANITIZED_BIO_NULL_FIELDS)[number];

/**
 * Patch applied to every `burner_bios` row belonging to the account (one per
 * edition). Personal free text and identifiers go to null; the arrays and
 * booleans that could re-identify someone (skills, attendance years, camp
 * history, volunteering interests, ranger flags) are reset to their empty
 * defaults.
 */
export type BurnerBioSanitizationPatch = Record<SanitizedBioNullField, null> & {
  skills: string[];
  attendedYears: number[];
  campHistory: null;
  volunteeringInterests: null;
  rangerTraining: null;
  rangerCurious: null;
  greenDotTraining: null;
  firstTime: false;
  privacyFlags: Record<string, boolean>;
  updatedAt: Date;
};

/**
 * Build the `burner_bios` patch. `privacyFlags` is reset to an EMPTY map rather
 * than preserved: the flags describe fields that no longer hold anything, and an
 * inherited `{ bio: true }` on a stub is meaningless noise.
 */
export function buildBioSanitizationPatch(
  at: Date,
): BurnerBioSanitizationPatch {
  const nulls = Object.fromEntries(
    SANITIZED_BIO_NULL_FIELDS.map((f) => [f, null]),
  ) as Record<SanitizedBioNullField, null>;

  return {
    ...nulls,
    skills: [],
    attendedYears: [],
    campHistory: null,
    volunteeringInterests: null,
    rangerTraining: null,
    rangerCurious: null,
    greenDotTraining: null,
    firstTime: false,
    privacyFlags: {},
    updatedAt: at,
  };
}

/**
 * The tables sanitization MUST NOT touch. Named explicitly so the intent is
 * testable: these carry the referential integrity the whole precedent exists to
 * protect, and none of them stores personal information about the departing
 * account (they store IDs, roles, statuses, and answers).
 */
export const SANITIZATION_PRESERVED_TABLES = [
  "memberships",
  "member_role_assignments",
  "questionnaire_responses",
  "required_actions",
  "audit_events",
  "supplier_document_acks",
  "supplier_declarations",
  "registrations",
  "section_reviews",
  "notifications",
] as const;

/**
 * Tables whose rows are deleted outright, because they hold nothing BUT secrets
 * or request context for an account that no longer exists and nothing references
 * them. `profile_keys` is a keypair; `email_change_requests` holds live tokens and
 * the old/new addresses (i.e. personal data); `security_events` holds the IP
 * addresses and user-agents captured with each account action (personal data
 * under POPIA) — none of it may outlive the account.
 */
export const SANITIZATION_PURGED_TABLES = [
  "profile_keys",
  "email_change_requests",
  "security_events",
] as const;

/**
 * The Better Auth IDENTITY tables whose rows are HARD-DELETED for the account —
 * the POPIA-critical step the "Lost Cat" plan hangs on. Our `users` row survives
 * as a stub, but the identity layer holds real personal data and live
 * credentials that must not outlive the account:
 *   - `session` — live session tokens, IP addresses and user-agents. Deleting
 *     these is what actually SIGNS THE ACCOUNT OUT everywhere; without it a stolen
 *     or lingering cookie stays valid indefinitely.
 *   - `account` — the bcrypt password hash (and any OAuth tokens). Without it the
 *     old password still authenticates.
 *   - `user`    — the identity's email (PII) plus name/verification state.
 * Deleting the `user` row cascades to `session` and `account` (FK
 * `onDelete: "cascade"`), but the app deletes all three explicitly and in order
 * so the erasure is unambiguous and idempotent under the no-transaction HTTP
 * driver. This must run BEFORE the `users` tombstone lands, so the tombstone only
 * ever marks an erasure that has actually happened.
 */
export const SANITIZATION_IDENTITY_TABLES = [
  "session",
  "account",
  "user",
] as const;

/** The complete plan, for the app to execute and the tests to assert over. */
export interface SanitizationPlan {
  userId: string;
  at: Date;
  user: UserSanitizationPatch;
  bio: BurnerBioSanitizationPatch;
  preservedTables: readonly string[];
  purgedTables: readonly string[];
  /** Better Auth identity tables the app hard-deletes (email PII, password hash,
   * live sessions) — the POPIA-critical erasure, run before the tombstone lands. */
  identityTables: readonly string[];
  /** The audit event to write LAST, recording that erasure happened. */
  audit: {
    action: "account.sanitized";
    subject: string;
    meta: Record<string, unknown>;
  };
}

/**
 * Build the full sanitization plan for an account. Pure — returns what to do.
 *
 * The audit event is part of the plan on purpose: POPIA erasure has to be
 * PROVABLE, and an erasure with no record of having happened is indistinguishable
 * from data loss. The event names no personal data (only our internal user id
 * and counts), so writing it does not undo the erasure it records.
 */
export function buildSanitizationPlan(input: {
  userId: string;
  at: Date;
  /** How many bio rows (editions) will be patched — recorded for the trail. */
  bioCount?: number;
  /** Preserved membership count — recorded so the trail shows what survived. */
  membershipCount?: number;
}): SanitizationPlan {
  const { userId, at } = input;
  return {
    userId,
    at,
    user: buildUserSanitizationPatch(userId, at),
    bio: buildBioSanitizationPatch(at),
    preservedTables: SANITIZATION_PRESERVED_TABLES,
    purgedTables: SANITIZATION_PURGED_TABLES,
    identityTables: SANITIZATION_IDENTITY_TABLES,
    audit: {
      action: "account.sanitized",
      subject: userId,
      meta: {
        reason: "deletion_grace_elapsed",
        bioRows: input.bioCount ?? null,
        membershipsPreserved: input.membershipCount ?? null,
        stub: DEPARTED_BURNER_NAME,
      },
    },
  };
}

/** True when a `users` row has already been sanitized. */
export function isSanitized(user: { sanitizedAt?: Date | null }): boolean {
  return user.sanitizedAt != null;
}

/**
 * The resurrection guard. A sanitized account must never be handed back a
 * session: its memberships and roles survive for integrity, so re-adopting the
 * row would hand a stranger (or the same person, post-erasure) a camp lead's
 * permissions. Call it wherever a session is resolved.
 */
export function assertNotSanitized(user: {
  sanitizedAt?: Date | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!isSanitized(user)) return { ok: true };
  return {
    ok: false,
    reason:
      "This account was deleted. If that wasn't you, contact AfrikaBurn — we can't restore it from here.",
  };
}

// --- Verification helpers (used by the sanitization-integrity tests) ------

/**
 * The personal fields that must be gone. Every always-private field (both the
 * hard-locked classes AND the safety-visible medical class) maps into the bio
 * patch, plus the non-locked personal free text. Returns the fields a given patch
 * FAILS to cover — empty means the patch is complete.
 *
 * The mapping exists because ./privacy names fields as the privacy-flag map does
 * (`saId`, `passport`, `medical`) while the columns are named as the schema does
 * (`saIdEncrypted`, `passportEncrypted`, `medicalNotes`).
 */
const ALWAYS_PRIVATE_TO_COLUMN: Readonly<Record<string, string>> = {
  saId: "saIdEncrypted",
  passport: "passportEncrypted",
  phone: "phone",
  onsiteContactName: "onsiteContactName",
  onsiteContactPhone: "onsiteContactPhone",
  offsiteContactName: "offsiteContactName",
  offsiteContactPhone: "offsiteContactPhone",
  medical: "medicalNotes",
};

/**
 * Prove a bio patch erases every ALWAYS-PRIVATE field (hard-locked +
 * safety-visible medical). Returns the field keys left uncovered; empty ⇒ compliant. This is the
 * guard that fails when someone adds an always-private class to ./privacy and
 * forgets the erasure path. Named `HardLocked` for backwards compatibility — the
 * scope is now the full never-public union so medical stays covered.
 */
export function uncoveredHardLockedFields(
  patch: Record<string, unknown>,
): string[] {
  return ALWAYS_PRIVATE_FIELDS.filter((field) => {
    const column = ALWAYS_PRIVATE_TO_COLUMN[field];
    if (column === undefined) return true;
    return patch[column] !== null;
  });
}

/**
 * True when no value in `patch` still contains any of the supplied personal
 * values (a burner's real name, phone, email…). The test-facing leak detector,
 * mirroring `notificationMentionsAny` in ./notifications.
 */
export function patchLeaksAny(
  patch: Record<string, unknown>,
  forbidden: readonly (string | null | undefined)[],
): boolean {
  const needles = forbidden
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.toLowerCase());
  if (needles.length === 0) return false;
  const haystack = JSON.stringify(patch).toLowerCase();
  return needles.some((n) => haystack.includes(n));
}

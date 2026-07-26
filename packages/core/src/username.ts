// Usernames — the burner's ONE real handle, and the only identity string the
// app shows to other people.
//
// WHY THIS EXISTS (Ryan, 27 Jul 2026): "The playa name is kinda cringe, please
// dont make it required, its optional and should be treated like an alias, not a
// root identity" → "lets do a unique username, keep usual username formatting
// and rules". The old `burner_bios.display_name` could never be that handle:
// bios are PER-EDITION (unique on user + edition), so one person could hold a
// different name every year and "unique" had no coherent meaning. The username
// therefore lives on `users` — account-level, one per person, forever.
//
// This module is the SINGLE place the rules live. Every surface that accepts a
// username (the bio flow, the availability check, the save path, the tests) goes
// through `validateUsername`, so the rules cannot drift between the field that
// checks them and the column that stores them.
//
// CASE. The canonical charset is lowercase, but a person who types `Dusty` means
// the same handle as `dusty` — so we STORE what they entered and enforce
// uniqueness on the LOWER-CASED value (`normalizeUsername`, backed by a unique
// index on `lower(username)` in migration 0016). That is the ordinary
// GitHub/Twitter behaviour, and it is what makes "case-insensitive uniqueness" a
// real constraint rather than a no-op.

import { DEPARTED_BURNER_NAME } from "./account-sanitization";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** The neutral stand-in shown wherever a burner has no username. NEVER their
 * legal name and NEVER their email — both are private by default, and using
 * either as a fallback would turn an empty field into a privacy incident. */
export const UNNAMED_BURNER = "Unnamed burner";

/** The one-line help text under the username field. Kept here so onboarding, the
 * profile editor and any future surface say the same true thing. */
export const USERNAME_HELP =
  "Optional — how you appear to other burners. 3–20 characters: letters, numbers and underscores. You can change it later.";

/**
 * Handles nobody may hold. Two reasons, both real:
 *   1. IMPERSONATION — `admin`, `afrikaburn`, `support` in a roster or an invite
 *      card reads as the platform speaking, not a burner.
 *   2. ROUTE SHADOWING — every first path segment of the three apps is here, so
 *      a handle can never collide with a URL if profiles are ever served at
 *      `/<username>`. Reserving them now is free; un-reserving one later is a
 *      one-line change, whereas taking a handle back from a real person is not.
 * Extend it rather than special-casing a check elsewhere.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  // Platform + org identity
  "admin",
  "administrator",
  "root",
  "sysadmin",
  "system",
  "afrikaburn",
  "afrika_burn",
  "quagga",
  "quaggaportal",
  "org",
  "official",
  "staff",
  "team",
  "moderator",
  "mod",
  "security",
  "support",
  "help",
  "helpdesk",
  "webmaster",
  "postmaster",
  "abuse",
  "noreply",
  "no_reply",
  "dpo",
  // Route segments (apps/web, apps/org, apps/suppliers)
  "api",
  "auth",
  "account",
  "accounts",
  "profile",
  "profiles",
  "settings",
  "onboarding",
  "directory",
  "camps",
  "camp",
  "burners",
  "burner",
  "projects",
  "vehicles",
  "artworks",
  "questionnaires",
  "notifications",
  "bulletins",
  "registrations",
  "suppliers",
  "supplier",
  "invite",
  "invites",
  "join",
  "signin",
  "sign_in",
  "signup",
  "sign_up",
  "signout",
  "sign_out",
  "logout",
  "login",
  "dashboard",
  "home",
  "index",
  "search",
  "static",
  "assets",
  "public",
  "favicon",
  "robots",
  "sitemap",
  // Action words that would read as a control, not a person
  "new",
  "edit",
  "delete",
  "continue",
  "cancel",
  "me",
  "you",
  "self",
  "everyone",
  "all",
  // Values that break as data
  "null",
  "undefined",
  "nan",
  "none",
  "true",
  "false",
  "anonymous",
  "unknown",
  "deleted",
  "departed",
  "unnamed",
  // Safety/role words that would imply an official function on site
  "ranger",
  "rangers",
  "medic",
  "medics",
  "safety",
  "dmv",
];

const RESERVED = new Set(RESERVED_USERNAMES);

/** The uniqueness key for a username: trimmed and lower-cased. The DB's unique
 * index on `lower(username)` is the real guarantee — this is what callers
 * compare and look up by so the two can never disagree. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when a candidate collides with the reserved list (case-insensitive). */
export function isReservedUsername(raw: string): boolean {
  return RESERVED.has(normalizeUsername(raw));
}

export type UsernameValidation =
  | {
      ok: true;
      /** Stored as entered (case preserved). */
      username: string;
      /** The uniqueness key — lower-cased. */
      normalized: string;
    }
  | { ok: false; error: string };

/**
 * Validate a candidate username. Returns a HUMAN error naming the one thing that
 * is wrong — never a regex, never a list of every rule at once, because "must
 * match ^[a-z][a-z0-9_]{2,19}$" tells a person nothing about what to type next.
 *
 * Blank is an ERROR here, not a pass: the field is optional, so callers treat an
 * empty box as "no username" BEFORE calling this. Reaching validation with an
 * empty string means something upstream lost the value.
 */
export function validateUsername(raw: string): UsernameValidation {
  const username = raw.trim();

  if (username === "") {
    return { ok: false, error: "Enter a username, or leave the field blank." };
  }
  if (username.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      error: `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`,
    };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`,
    };
  }

  const normalized = username.toLowerCase();

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return {
      ok: false,
      error: "Usernames can only use letters, numbers and underscores.",
    };
  }
  if (!/^[a-z]/.test(normalized)) {
    return { ok: false, error: "Usernames must start with a letter." };
  }
  if (normalized.endsWith("_")) {
    return { ok: false, error: "Usernames can't end with an underscore." };
  }
  if (normalized.includes("__")) {
    return {
      ok: false,
      error: "Usernames can't contain two underscores in a row.",
    };
  }
  if (RESERVED.has(normalized)) {
    return {
      ok: false,
      error: "That username is reserved. Please pick a different one.",
    };
  }

  return { ok: true, username, normalized };
}

/**
 * A member's PUBLIC-facing name — THE fallback decision, made once and used by
 * every roster, directory, invite card and profile heading.
 *
 * Order: the username, then the neutral placeholder. There is deliberately NO
 * third option: falling back to a legal name or an account email would take a
 * private-by-default field and publish it the moment someone skipped the
 * (optional) username, which is a privacy regression disguised as a nicety.
 *
 * A SANITIZED account renders as the "Departed Burner" stub instead: deletion
 * frees the handle (POPIA erasure — the username is personal data), but the row
 * survives so a camp's roster keeps its shape, and "Departed Burner" says what
 * happened where "Unnamed burner" would imply someone who just never filled the
 * field in. Callers that have the tombstone to hand pass it; callers that don't
 * degrade safely to the placeholder.
 */
export function publicMemberName(
  username: string | null | undefined,
  options?: { sanitizedAt?: Date | null },
): string {
  if (options?.sanitizedAt != null) return DEPARTED_BURNER_NAME;
  const trimmed = username?.trim();
  return trimmed ? trimmed : UNNAMED_BURNER;
}

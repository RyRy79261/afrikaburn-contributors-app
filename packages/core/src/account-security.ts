// Account management & security domain logic (docs/accounts-security-spec.md,
// grounded in NIST SP 800-63B-4 Jul 2025 + OWASP auth guidance).
//
// PURITY CONTRACT (as with the rest of @quagga/core): no I/O, no env, no DB, no
// crypto primitives (hashing lives in the apps, where a runtime exists). This
// module owns the RULES — password policy, enumeration-safe messaging, the
// deletion grace-period state machine, the email-change state machine, and the
// three deletion guards — so every app enforces one implementation and the
// tests can prove it without a database.
//
// The provider capability matrix lives next door in ./auth-capabilities.

import type { AccountDeletionStatus, EmailChangeStatus } from "@quagga/types";

// --- Password policy ------------------------------------------------------
// NIST SP 800-63B-4: length is the control that matters. Minimum 15 for a
// single-factor authenticator, accept at least 64, allow every printable
// character including spaces, allow paste. NO composition rules, NO forced
// rotation, NO confirm-twice field, NO password hints, NO knowledge-based
// recovery questions. Breach-blocklist checking is the one substantive check —
// it needs I/O (haveibeenpwned k-anonymity), so it is the app's job; this module
// only decides everything that can be decided purely.

/** NIST minimum for a single-factor (password-only) authenticator. */
export const PASSWORD_MIN_LENGTH = 15;

/** NIST "SHALL accept": at least 64 characters. We take the whole 64. */
export const PASSWORD_MAX_LENGTH = 64;

/** Length-based strength bands. Deliberately not entropy theatre. */
export type PasswordStrength = "too_short" | "fair" | "good" | "strong";

export interface PasswordAssessment {
  ok: boolean;
  strength: PasswordStrength;
  length: number;
  /** How many more characters are needed to clear the minimum (0 once valid). */
  remaining: number;
  /** Null when acceptable; otherwise the single, honest reason. */
  error: string | null;
}

/**
 * Assess a candidate password against the policy. Composition is never
 * consulted — only length, and only against the two thresholds. Whitespace is
 * significant (a passphrase's spaces are real characters), so the value is NOT
 * trimmed; the only normalisation is the Unicode NFKC form NIST recommends so
 * the same typed passphrase measures the same on every platform.
 */
export function assessPassword(password: string): PasswordAssessment {
  const normalized = password.normalize("NFKC");
  const length = [...normalized].length;

  if (length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      strength: "too_short",
      length,
      remaining: PASSWORD_MIN_LENGTH - length,
      error: `A little longer — ${PASSWORD_MIN_LENGTH - length} more character${
        PASSWORD_MIN_LENGTH - length === 1 ? "" : "s"
      } to go.`,
    };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      strength: "strong",
      length,
      remaining: 0,
      error: `That's longer than we can store — keep it to ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  const strength: PasswordStrength =
    length >= 24 ? "strong" : length >= 18 ? "good" : "fair";
  return { ok: true, strength, length, remaining: 0, error: null };
}

// --- Enumeration-safe messaging -------------------------------------------
// OWASP: sign-in, sign-up and forgot-password must not reveal whether an account
// exists. The rule is that the SAME message ships on success and failure, and
// the response must not branch on account existence anywhere the user can see —
// including timing-sensitive redirects. Every auth surface pulls its copy from
// here so no one hand-writes "no account with that email".

export type EnumerationSafeSurface =
  "sign_in" | "sign_up" | "forgot_password" | "email_change_request";

/**
 * The one message a surface may show, whether or not the account exists. Used
 * for BOTH outcomes — that identity is the whole point, and the tests assert it.
 */
export const ENUMERATION_SAFE_MESSAGES: Readonly<
  Record<EnumerationSafeSurface, string>
> = {
  sign_in: "That email and password combination didn't work. Please try again.",
  sign_up:
    "Check your inbox — if we can create that account, a confirmation link is on its way.",
  forgot_password:
    "If that account exists, we've emailed a reset link. Check your inbox.",
  email_change_request:
    "If that address can be used, we've emailed it a confirmation link.",
};

/** The enumeration-safe message for a surface. Never branch on existence. */
export function enumerationSafeMessage(
  surface: EnumerationSafeSurface,
): string {
  return ENUMERATION_SAFE_MESSAGES[surface];
}

/**
 * Collapse an outcome to its enumeration-safe response. Takes the real result
 * (which the server knows) and returns what the USER is told — identical either
 * way. Keeping this a function rather than a convention means a caller cannot
 * accidentally pass the truthful branch through to the client.
 */
export function enumerationSafeResponse(
  surface: EnumerationSafeSurface,
  _accountExisted: boolean,
): { message: string } {
  void _accountExisted;
  return { message: ENUMERATION_SAFE_MESSAGES[surface] };
}

/**
 * True when a message would leak account existence. The regression guard: any
 * copy shipped from an auth surface is run through this in tests.
 */
export function leaksAccountExistence(message: string): boolean {
  const m = message.toLowerCase();
  return [
    "no account",
    "not registered",
    "doesn't exist",
    "does not exist",
    "unknown email",
    "email not found",
    "user not found",
    "no user",
    "already registered",
    "already exists",
    "already taken",
    "account exists with",
  ].some((phrase) => m.includes(phrase));
}

// --- Deletion: the 14-day grace-period state machine ----------------------
// Spec: re-auth to request → 14-day grace (cancelled by simply signing in) →
// then SANITIZATION (see ./account-sanitization), never a row delete.

export const DELETION_GRACE_PERIOD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a grace period started at `requestedAt` elapses. */
export function deletionGraceEndsAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_PERIOD_DAYS * DAY_MS);
}

/** The stored shape this module reasons over (a row from `account_deletion_requests`). */
export interface DeletionRequestState {
  status: AccountDeletionStatus;
  requestedAt: Date;
  graceEndsAt: Date;
  cancelledAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * What the account is actually in, right now.
 * - `none`         — no live request.
 * - `grace`        — pending, grace still running; cancelable.
 * - `due`          — pending, grace elapsed; sanitization is owed.
 * - `cancelled`    — the burner came back.
 * - `sanitized`    — done; the stub is all that remains.
 */
export type DeletionPhase =
  "none" | "grace" | "due" | "cancelled" | "sanitized";

/** Resolve the phase of a request at `now`. Null request ⇒ `none`. */
export function deletionPhase(
  request: DeletionRequestState | null | undefined,
  now: Date,
): DeletionPhase {
  if (!request) return "none";
  switch (request.status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "sanitized";
    case "pending":
      return now.getTime() >= request.graceEndsAt.getTime() ? "due" : "grace";
  }
}

/** Whole days left in the grace period (rounded up, floored at 0). */
export function deletionDaysRemaining(
  request: DeletionRequestState | null | undefined,
  now: Date,
): number {
  if (!request || request.status !== "pending") return 0;
  const ms = request.graceEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/**
 * Whether the grace period may still be cancelled. Signing in is enough — the
 * spec is explicit that coming back cancels it, with no extra confirmation.
 */
export function canCancelDeletion(
  request: DeletionRequestState | null | undefined,
  now: Date,
): boolean {
  return deletionPhase(request, now) === "grace";
}

/**
 * Whether the sweeper should sanitize this account now. Only a `pending` request
 * whose grace has fully elapsed qualifies — `due` and nothing else. Deliberately
 * strict: a cancelled or already-completed row must never be re-processed.
 */
export function isSanitizationDue(
  request: DeletionRequestState | null | undefined,
  now: Date,
): boolean {
  return deletionPhase(request, now) === "due";
}

export type DeletionTransition =
  | { ok: true; status: AccountDeletionStatus; at: Date }
  | { ok: false; reason: string };

/**
 * The sign-in hook: a burner who signs in during the grace period has their
 * deletion cancelled. Returns the transition to persist, or a refusal when there
 * is nothing to cancel. Idempotent by construction — call it on every sign-in.
 */
export function cancelDeletionOnSignIn(
  request: DeletionRequestState | null | undefined,
  now: Date,
): DeletionTransition {
  if (!request) return { ok: false, reason: "No deletion request is pending." };
  const phase = deletionPhase(request, now);
  if (phase === "grace") return { ok: true, status: "cancelled", at: now };
  if (phase === "due") {
    // The grace period has already elapsed. Signing in does NOT rescue it
    // silently — the account is owed sanitization and the request must be
    // resolved deliberately, not by a race between a login and the sweeper.
    return {
      ok: false,
      reason:
        "The grace period for this deletion has already elapsed and is being processed.",
    };
  }
  return { ok: false, reason: "No deletion request is pending." };
}

// --- Deletion guards (spec §Deletion "Constraints") -----------------------
// Three hard blocks, all enforced server-side. Each returns a REASON the UI can
// show verbatim, because "you can't delete this" without a why is a dead end.

/** A camp/project the account leads, for the sole-lead guard. */
export interface LedProject {
  groupId: string;
  name: string;
  /** How many memberships on that group hold a structural `lead` role. */
  leadCount: number;
}

/** Everything the guards need to know. Assembled by the app from the DB. */
export interface DeletionGuardContext {
  /** Projects where this account holds the structural `lead` role. */
  ledProjects: readonly LedProject[];
  /** True when this account holds `god` on the org group. */
  isOrgGod: boolean;
  /** Total number of god accounts across the org (including this one). */
  orgGodCount: number;
  /** How many sign-in methods (password + linked socials) the account has. */
  signInMethodCount: number;
  /** True when the supplier account has an unfinished onboarding (warn, not block). */
  hasInFlightSupplierOnboarding?: boolean;
  /**
   * The org rank this account holds, or null. NOT a block — deleting an org
   * staffer strands nobody — but it is console access that is about to be
   * revoked, and it was previously invisible: this assessor knew only `god`, so
   * `org_staff` and `engineer` could self-delete through the participant app
   * with no warning while their `org_role_assignments` survived on the tombstone.
   */
  orgRole?: string | null;
  /**
   * The supplier listing this account has claimed, by name, or null. Warned
   * about because the listing is released back to unclaimed on sanitization —
   * the business survives, the link does not.
   */
  claimedSupplierName?: string | null;
}

export type DeletionBlockCode =
  "sole_camp_lead" | "sole_org_god" | "no_sign_in_method";

export interface DeletionBlock {
  code: DeletionBlockCode;
  message: string;
  /** Groups the burner must hand over first (sole_camp_lead only). */
  groupIds?: string[];
}

export interface DeletionWarning {
  code:
    | "supplier_onboarding_in_flight"
    | "org_access_revoked"
    | "supplier_listing_released";
  message: string;
}

export interface DeletionEligibility {
  ok: boolean;
  blocks: DeletionBlock[];
  warnings: DeletionWarning[];
}

/**
 * Can this account be deleted? Evaluates all three guards and returns EVERY
 * block at once (not the first) — a burner blocked on two counts deserves to
 * see both rather than discovering the second after fixing the first.
 *
 * Guards:
 *  1. **Sole camp lead** — a project whose only `lead` is this account would be
 *     orphaned. Leadership must be transferred first (the guided flow); the
 *     structural-role law makes `lead` the no-lockout backstop, so losing the
 *     last one is unrecoverable without org intervention.
 *  2. **Sole org god** — the last god cannot self-delete. Same backstop
 *     reasoning, one level up: nobody would be left who could grant it back.
 *  3. **Last sign-in method** — an account with one remaining method cannot
 *     unlink it. (Enforced here too so the deletion flow, which walks the same
 *     surface, can't be used as a side door.)
 */
export function assessDeletionEligibility(
  ctx: DeletionGuardContext,
): DeletionEligibility {
  const blocks: DeletionBlock[] = [];
  const warnings: DeletionWarning[] = [];

  const sole = ctx.ledProjects.filter((p) => p.leadCount <= 1);
  if (sole.length > 0) {
    const names = sole.map((p) => p.name).join(", ");
    blocks.push({
      code: "sole_camp_lead",
      groupIds: sole.map((p) => p.groupId),
      message:
        sole.length === 1
          ? `You're the only lead of ${names}. Transfer leadership to another member first — we'll walk you through it.`
          : `You're the only lead of ${sole.length} projects (${names}). Transfer leadership for each one first — we'll walk you through it.`,
    });
  }

  if (ctx.isOrgGod && ctx.orgGodCount <= 1) {
    blocks.push({
      code: "sole_org_god",
      message:
        "You're the only god administrator. Grant god to someone else before deleting this account — otherwise nobody could grant it back.",
    });
  }

  if (ctx.signInMethodCount <= 0) {
    blocks.push({
      code: "no_sign_in_method",
      message:
        "This account has no usable sign-in method, so we can't confirm it's you. Contact AfrikaBurn to sort it out.",
    });
  }

  // Console access is not a lockout risk — losing an `org_staff` account
  // strands nobody — so it warns rather than blocks. It exists because the
  // consequence copy never mentioned console access at all, and the person
  // deleting is usually the only one who knows they had it.
  if (ctx.orgRole && ctx.orgRole !== "member") {
    warnings.push({
      code: "org_access_revoked",
      message:
        "This account has AfrikaBurn console access. Deleting it revokes every org role it holds — a System manager has to grant them again to whoever takes the work over.",
    });
  }

  if (ctx.claimedSupplierName) {
    warnings.push({
      code: "supplier_listing_released",
      message: `${ctx.claimedSupplierName} is claimed by this account. Deleting it releases the listing so the business can be claimed again — the listing and its history stay, your link to it does not. Note that the contact address on the business record is part of that record and is not erased with your account.`,
    });
  }

  if (ctx.hasInFlightSupplierOnboarding) {
    warnings.push({
      code: "supplier_onboarding_in_flight",
      // "…and notifies the AfrikaBurn supplier team" stood here and was false —
      // nothing anywhere sends that. It went unnoticed because the field driving
      // this warning was never populated, so the card had never rendered for a
      // single person; wiring the field up on 31 Jul 2026 would have shipped the
      // false promise to the first supplier who tried to delete. Either build
      // the notification or stop claiming it, and claiming it is the one thing
      // that cannot stay.
      message:
        "Your supplier onboarding for this edition isn't finished. Deleting your account leaves it incomplete — tell your AfrikaBurn contact if someone else is taking it over.",
    });
  }

  return { ok: blocks.length === 0, blocks, warnings };
}

/**
 * The last-sign-in-method guard on its own — used by the /account surface's
 * unlink control, which is a different action from deletion.
 */
export function canUnlinkSignInMethod(
  signInMethodCount: number,
): { ok: true } | { ok: false; reason: string } {
  if (signInMethodCount > 1) return { ok: true };
  return {
    ok: false,
    reason:
      "This is your only way to sign in. Add another sign-in method before removing this one.",
  };
}

// --- Email change: the 48h-revocable state machine ------------------------
// Spec: confirm via the NEW address, notify the OLD address with a revocation
// link, revocable for 48h. See `email_change_requests` in @quagga/db for why we
// own this rather than delegating it to the provider.

/** How long a confirmation link stays live. Short by design. */
export const EMAIL_CHANGE_CONFIRM_TTL_HOURS = 2;

/** How long the OLD address may revoke a confirmed change. */
export const EMAIL_CHANGE_REVOCATION_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

/** Expiry for a confirmation token issued at `requestedAt`. */
export function emailChangeExpiresAt(requestedAt: Date): Date {
  return new Date(
    requestedAt.getTime() + EMAIL_CHANGE_CONFIRM_TTL_HOURS * HOUR_MS,
  );
}

/** The end of the revocation window for a change confirmed at `confirmedAt`. */
export function emailChangeRevocableUntil(confirmedAt: Date): Date {
  return new Date(
    confirmedAt.getTime() + EMAIL_CHANGE_REVOCATION_HOURS * HOUR_MS,
  );
}

/** The stored shape (a row from `email_change_requests`). */
export interface EmailChangeState {
  status: EmailChangeStatus;
  expiresAt: Date;
  confirmedAt?: Date | null;
  revocableUntil?: Date | null;
  revokedAt?: Date | null;
  /** Non-null only when the provider actually applied the new address. */
  providerCommittedAt?: Date | null;
}

/**
 * Where a request stands right now.
 * - `none`               — nothing in flight.
 * - `awaiting_confirm`   — pending and the token is still live.
 * - `expired`            — pending but the token lapsed (treat as dead).
 * - `revocable`          — confirmed, inside the 48h window.
 * - `settled`            — confirmed and past the window (final).
 * - `revoked`            — the OLD address pulled it back.
 * - `cancelled`          — abandoned or superseded.
 */
export type EmailChangePhase =
  | "none"
  | "awaiting_confirm"
  | "expired"
  | "revocable"
  | "settled"
  | "revoked"
  | "cancelled";

export function emailChangePhase(
  request: EmailChangeState | null | undefined,
  now: Date,
): EmailChangePhase {
  if (!request) return "none";
  switch (request.status) {
    case "revoked":
      return "revoked";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "pending":
      return now.getTime() >= request.expiresAt.getTime()
        ? "expired"
        : "awaiting_confirm";
    case "confirmed": {
      const until = request.revocableUntil;
      if (!until) return "settled";
      return now.getTime() < until.getTime() ? "revocable" : "settled";
    }
  }
}

/** A confirmation token may only be redeemed while `awaiting_confirm`. */
export function canConfirmEmailChange(
  request: EmailChangeState | null | undefined,
  now: Date,
): boolean {
  return emailChangePhase(request, now) === "awaiting_confirm";
}

/** The OLD address may revoke only inside the 48h window. */
export function canRevokeEmailChange(
  request: EmailChangeState | null | undefined,
  now: Date,
): boolean {
  return emailChangePhase(request, now) === "revocable";
}

/**
 * THE HONESTY CHECK. A request is only allowed to be PRESENTED as a completed
 * change when the identity provider actually applied it. A `confirmed` row with
 * a null `providerCommittedAt` means our side of the handshake succeeded and the
 * provider's did not — the burner still signs in with the old address, and
 * saying otherwise would be a lie that locks them out in their own head.
 */
export function isEmailChangeEffective(
  request: EmailChangeState | null | undefined,
): boolean {
  if (!request) return false;
  if (request.status !== "confirmed") return false;
  return request.providerCommittedAt != null;
}

/** Whole hours left to revoke (rounded up, floored at 0). */
export function emailChangeHoursToRevoke(
  request: EmailChangeState | null | undefined,
  now: Date,
): number {
  if (!request?.revocableUntil || request.status !== "confirmed") return 0;
  const ms = request.revocableUntil.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / HOUR_MS);
}

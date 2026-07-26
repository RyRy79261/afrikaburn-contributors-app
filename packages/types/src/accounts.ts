import { z } from "zod";

// Account management & security vocabularies (docs/accounts-security-spec.md).
//
// IMPORTANT CONTEXT — what the identity provider actually gives us. We run
// SELF-HOSTED Better Auth (@quagga/auth, better-auth 1.6.25), mounted in-process
// in each app against our own Neon DB. Self-hosting lets us install Better Auth
// server plugins, so the full surface — including TOTP two-factor + encrypted
// backup codes (twoFactor plugin) and WebAuthn passkeys (@better-auth/passkey),
// both landed in migration 0015 — is now real. The capability matrix is the
// machine-readable record of what actually ships — see `AUTH_CAPABILITIES` in
// @quagga/core for the authority, and `docs/accounts-security-spec.md` for the
// narrative. Nothing in this file assumes a capability the stack does not expose.
//
// Keep every enum here in sync with the matching pgEnum in @quagga/db schema.ts.

/**
 * Lifecycle of an account-deletion request (`account_deletion_requests.status`).
 * Deletion is never an immediate row delete — it is a 14-day grace period
 * followed by SANITIZATION (the Camp 404 "Lost Cat" precedent): personal fields
 * are erased and the account is anonymized to a stub so memberships,
 * questionnaire responses, and audit history keep referential integrity.
 * - `pending`   — requested; the grace period is running (cancelable).
 * - `cancelled` — the burner came back (signing in cancels it) or cancelled it.
 * - `completed` — the grace period elapsed and sanitization has been applied.
 */
export const AccountDeletionStatus = z.enum([
  "pending",
  "cancelled",
  "completed",
]);
export type AccountDeletionStatus = z.infer<typeof AccountDeletionStatus>;

/**
 * Lifecycle of an email-change request (`email_change_requests.status`).
 * Our flow (spec): confirm via the NEW address, notify the OLD address with a
 * revocation link, revocable for 48h after confirmation.
 * - `pending`   — requested; the confirmation token is live and unexpired.
 * - `confirmed` — the new address confirmed; the 48h revocation window is open.
 * - `revoked`   — the OLD address revoked it inside the window.
 * - `expired`   — the confirmation token lapsed unused.
 * - `cancelled` — the account holder abandoned it (or superseded it).
 */
export const EmailChangeStatus = z.enum([
  "pending",
  "confirmed",
  "revoked",
  "expired",
  "cancelled",
]);
export type EmailChangeStatus = z.infer<typeof EmailChangeStatus>;

/**
 * The account-security capabilities this platform cares about. Used as the key
 * space of the capability matrix so "is 2FA available?" is answered by data, not
 * by a comment someone forgot to update.
 */
export const AuthCapabilityKey = z.enum([
  "passwordChange",
  "passwordReset",
  "emailVerification",
  "sessionList",
  "sessionRevoke",
  "emailChange",
  "accountDeletion",
  "linkedAccounts",
  "unlinkAccount",
  "twoFactor",
  "backupCodes",
  "passkeys",
]);
export type AuthCapabilityKey = z.infer<typeof AuthCapabilityKey>;

/**
 * How well our (now self-hosted) Better Auth stack supports a capability.
 * - `supported`   — @quagga/auth exposes a SERVER method (`auth.api.*`) we can
 *                   call and trust; safe to build the full flow on.
 * - `client_only` — retained for the type's history; no capability is in this
 *                   interim state under self-hosting (it described the managed
 *                   Neon era, where the browser client exposed a method the
 *                   server allowlist omitted and we could not verify upstream).
 * - `unavailable` — the backing Better Auth PLUGIN is not installed yet (e.g.
 *                   twoFactor, passkey). Never fake it; seam + document instead,
 *                   and flip it here the day the plugin lands.
 */
export const AuthCapabilitySupport = z.enum([
  "supported",
  "client_only",
  "unavailable",
]);
export type AuthCapabilitySupport = z.infer<typeof AuthCapabilitySupport>;

/**
 * Security-notification kinds we emit over Resend (spec §"Security
 * notifications"). `new_device_sign_in` is listed but only fires if the session
 * list gives us a device we have not seen — see `AUTH_CAPABILITIES`.
 */
export const SecurityEventKind = z.enum([
  "password_changed",
  "password_reset_completed",
  "email_change_requested",
  "email_change_completed",
  "email_change_revoked",
  "new_device_sign_in",
  "session_revoked",
  "deletion_requested",
  "deletion_cancelled",
  "deletion_completed",
]);
export type SecurityEventKind = z.infer<typeof SecurityEventKind>;

/**
 * The typed kinds of the `security_events` LOG (distinct from the Resend
 * `SecurityEventKind` above, which types outbound notifications). This mirrors the
 * `security_event_kind` pgEnum in @quagga/db schema.ts — the account security
 * page's "recent security events" feed reads real rows of these, and
 * @quagga/core `describeSecurityEvent` turns each into a display title/detail.
 * Every value corresponds to an event that already fires in the account actions:
 * password change, password reset completion, single-session revoke, sign-out-
 * everywhere, the three email-change steps, and deletion request/cancel.
 */
export const SecurityEventLogKind = z.enum([
  "password_changed",
  "password_reset_completed",
  "session_revoked",
  "sessions_revoked_others",
  "email_change_requested",
  "email_change_confirmed",
  "email_change_revoked",
  "deletion_requested",
  "deletion_cancelled",
]);
export type SecurityEventLogKind = z.infer<typeof SecurityEventLogKind>;

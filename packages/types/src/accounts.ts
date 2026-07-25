import { z } from "zod";

// Account management & security vocabularies (docs/accounts-security-spec.md).
//
// IMPORTANT CONTEXT — what the identity provider actually gives us. We run on
// MANAGED Neon Auth ("Managed Better Auth", better-auth 1.4.18 under the hood).
// Neon owns the auth tables and the server config; we cannot install Better Auth
// server plugins (neon.com/docs/auth/guides/plugins: "You don't install or
// configure Better Auth plugins directly"). The capability matrix below is the
// machine-readable record of that boundary — see `AUTH_CAPABILITIES` in
// @quagga/core for the authority, and `docs/accounts-security-spec.md` for the
// narrative. Nothing in this file assumes a capability the SDK does not expose.
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
 * How well the identity provider supports a capability.
 * - `supported`   — the Neon Auth SDK exposes a SERVER method we can call and
 *                   trust; safe to build the full flow on.
 * - `client_only` — only the browser client exposes it (the `/api/auth/*` proxy
 *                   forwards arbitrary paths to the managed Better Auth
 *                   instance), so it MAY work, but the server SDK's typed
 *                   endpoint allowlist omits it and we cannot verify upstream
 *                   enablement without a live instance. Treat as unverified.
 * - `unavailable` — structurally absent (the plugin cannot be installed on a
 *                   managed instance). Never fake it; seam + document instead.
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

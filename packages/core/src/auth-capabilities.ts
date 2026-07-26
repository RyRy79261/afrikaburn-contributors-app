// What our identity provider ACTUALLY supports (the capability matrix).
//
// As of the self-hosted migration (docs/auth-platform-spec.md) we run our OWN
// Better Auth (1.6.x), mounted in-process in each app by @quagga/auth against our
// own Neon database — NOT managed Neon Auth. Self-hosting removes the managed
// provider's fixed-subset limitation: every core email/password + session +
// account capability is now a real server call on `auth.api.*`, and change-email
// / unlink (which managed Neon omitted from its server allowlist) are ours.
//
// WHAT IS STILL UNAVAILABLE, AND WHY IT CHANGED: 2FA/TOTP, backup codes, and
// passkeys are no longer blocked by the PROVIDER — they are Better Auth PLUGINS
// (twoFactor, @better-auth/passkey) that we have not installed YET. They land in a
// later task (auth-platform-spec P1-2 for 2FA + backup codes, P1-14b for
// passkeys), each adding its own append-only table. Until those plugins are wired
// into @quagga/auth, the surfaces render an honest "not available yet" state and
// their actions fail closed — this file is where that flips, in one reviewed diff,
// the day the plugin ships.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: never fake an unsupported capability. A
// surface for an `unavailable` capability must render an honest "not available
// yet" state and its action must fail closed — never a silent no-op that looks
// like success. `assertCapability` is the fail-closed helper.

import type { AuthCapabilityKey, AuthCapabilitySupport } from "@quagga/types";

export interface AuthCapability {
  key: AuthCapabilityKey;
  support: AuthCapabilitySupport;
  /**
   * The Better Auth method backing it, or null when nothing backs it yet.
   * `auth.api.*` names are the in-process server API exposed by @quagga/auth.
   */
  method: string | null;
  /** Why it is in this state — surfaced verbatim in dev diagnostics. */
  reason: string;
  /** Honest, user-facing copy for a surface that cannot function. */
  userMessage?: string;
}

/**
 * The matrix. Ordered as the spec's Security-principles list, so a reader can
 * walk the spec and this table side by side.
 */
export const AUTH_CAPABILITIES: Readonly<
  Record<AuthCapabilityKey, AuthCapability>
> = {
  passwordChange: {
    key: "passwordChange",
    support: "supported",
    method: "auth.api.changePassword",
    reason:
      "Self-hosted email/password is enabled; `changePassword` re-auths with the current password and can revoke other sessions.",
  },
  passwordReset: {
    key: "passwordReset",
    support: "supported",
    method: "auth.api.requestPasswordReset + auth.api.resetPassword",
    reason:
      "Native to self-hosted email/password. `revokeSessionsOnPasswordReset` is set true in @quagga/auth so a reset ends every session. Reset EMAIL delivery still depends on an email provider (RESEND_API_KEY); the flow presents as unavailable to the user until a key exists, but the capability itself is supported.",
  },
  emailVerification: {
    key: "emailVerification",
    support: "supported",
    method: "auth.api.sendVerificationEmail + auth.api.verifyEmail",
    reason:
      "Native to self-hosted Better Auth. Whether verification is REQUIRED is derived from provider presence (@quagga/auth resolveRequireEmailVerification); the endpoints exist regardless.",
  },
  sessionList: {
    key: "sessionList",
    support: "supported",
    method: "auth.api.listSessions",
    reason:
      "Database sessions (Better Auth default) give the revocable active-session list.",
  },
  sessionRevoke: {
    key: "sessionRevoke",
    support: "supported",
    method: "auth.api.revokeSession / revokeSessions / revokeOtherSessions",
    reason:
      "Database sessions are individually revocable; a cookie-cache read may honour a revoked session for up to its 5-minute maxAge.",
  },
  emailChange: {
    key: "emailChange",
    support: "supported",
    method: "auth.api.changeEmail",
    reason:
      "Self-hosting unlocks server-side change-email (`user.changeEmail.enabled` is set in @quagga/auth, with `sendChangeEmailVerification` wired to Resend) — it was ABSENT from managed Neon's server allowlist. Better Auth owns the identity-side token; the 48h revocation window and POPIA state machine stay ours in @quagga/core + `email_change_requests`. Committing the new address still requires an email provider to deliver the confirmation, so the user-facing flow is gated on RESEND_API_KEY.",
  },
  accountDeletion: {
    key: "accountDeletion",
    support: "supported",
    method: "sanitizeAccount (@quagga/web) — direct identity delete + app-row sanitization",
    reason:
      "Deletion is a 14-day-grace + sweeper flow, not a single call. The sweeper's `sanitizeAccount` erases our application rows (the 'Lost Cat' plan; our `users` row survives as a stub) AND hard-deletes the Better Auth IDENTITY — the `session`, `account` (password hash) and `user` (email PII) rows — by direct transactional delete on the shared DB (SANITIZATION_IDENTITY_TABLES). We do this ourselves rather than via `auth.api.deleteUser` because the sanitization ordering, tombstone and audit trail are ours to own; the effect (identity gone, sessions revoked, cannot sign back in) is the same. The `users` tombstone (`sanitizedAt`) is enforced at every session resolver via `assertNotSanitized`/`isSanitized`.",
  },
  linkedAccounts: {
    key: "linkedAccounts",
    support: "supported",
    method: "auth.api.listUserAccounts + auth.api.accountInfo",
    reason:
      "Lists linked sign-in methods (password, Google) and backs the last-method guard.",
  },
  unlinkAccount: {
    key: "unlinkAccount",
    support: "supported",
    method: "auth.api.unlinkAccount",
    reason:
      "Self-hosting exposes `unlinkAccount` server-side (managed Neon omitted it). The last-sign-in-method guard is still enforced by us from `listUserAccounts` — a member can never unlink their only method.",
  },
  twoFactor: {
    key: "twoFactor",
    support: "unavailable",
    method: null,
    reason:
      "The `twoFactor` plugin (TOTP + backup codes) is not yet installed in @quagga/auth. It is a self-host plugin we CAN add — unblocked by the migration — and is scheduled (auth-platform-spec P1-2), not blocked by the provider. Flip to supported when the plugin and its `two_factor` table land.",
    userMessage:
      "Two-factor authentication isn't available on this account yet. We're rolling it out — we'll turn it on the day it lands.",
  },
  backupCodes: {
    key: "backupCodes",
    support: "unavailable",
    method: null,
    reason:
      "Backup codes ship inside the `twoFactor` plugin (store them encrypted, never plaintext); unavailable until that plugin is installed.",
    userMessage:
      "Backup codes arrive with two-factor authentication, which isn't available yet.",
  },
  passkeys: {
    key: "passkeys",
    support: "unavailable",
    method: null,
    reason:
      "The `@better-auth/passkey` plugin is not yet installed. Self-hosting unblocks it (rpID must be the apex from day one), but it is a later phase (auth-platform-spec P1-14b) with an open single-vs-array `origin` spike; not a provider block.",
    userMessage:
      "Passkeys aren't available on this account yet.",
  },
};

/** True when a capability has a server method we can call and trust. */
export function isCapabilitySupported(key: AuthCapabilityKey): boolean {
  return AUTH_CAPABILITIES[key].support === "supported";
}

/**
 * True when a capability is not currently deliverable (its plugin is not yet
 * installed). Surfaces MUST render an honest unavailable state for these, never a
 * control that appears to work.
 */
export function isCapabilityUnavailable(key: AuthCapabilityKey): boolean {
  return AUTH_CAPABILITIES[key].support === "unavailable";
}

/**
 * The honest user-facing message for a capability we cannot deliver. Null when
 * the capability is fully supported (nothing to explain).
 */
export function capabilityUserMessage(key: AuthCapabilityKey): string | null {
  const cap = AUTH_CAPABILITIES[key];
  return cap.support === "supported" ? null : (cap.userMessage ?? null);
}

/** Every capability we cannot currently deliver — the "documented gaps" list. */
export function unavailableCapabilities(): AuthCapability[] {
  return Object.values(AUTH_CAPABILITIES).filter(
    (c) => c.support !== "supported",
  );
}

export type CapabilityGuardResult =
  | { ok: true }
  | { ok: false; message: string; support: AuthCapabilitySupport };

/**
 * FAIL-CLOSED gate for an action that needs a provider capability. Call this at
 * the TOP of any server action touching a not-yet-shipped flow: it returns a
 * refusal the caller surfaces honestly, so the flow can never report success it
 * did not achieve.
 */
export function assertCapability(
  key: AuthCapabilityKey,
): CapabilityGuardResult {
  const cap = AUTH_CAPABILITIES[key];
  if (cap.support === "supported") return { ok: true };
  return {
    ok: false,
    support: cap.support,
    message:
      cap.userMessage ??
      "That isn't available on this account yet. Nothing has changed.",
  };
}

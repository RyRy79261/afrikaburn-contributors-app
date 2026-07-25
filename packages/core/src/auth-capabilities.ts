// What our identity provider ACTUALLY supports (the capability matrix).
//
// docs/accounts-security-spec.md was written against stock Better Auth 1.4, whose
// plugin catalogue includes 2FA/TOTP and passkeys. We do not run stock Better
// Auth: we run MANAGED Neon Auth ("Managed Better Auth"), a Neon-hosted service
// that happens to run better-auth 1.4.18 internally. Neon owns the auth tables
// AND the server configuration, and states plainly that you "don't install or
// configure Better Auth plugins directly" — a managed instance exposes a fixed
// subset. Every plugin-delivered capability is therefore outside our reach, no
// matter what the Better Auth docs say.
//
// EVIDENCE (probe run 25 Jul 2026, @neondatabase/auth 0.4.1-beta):
//   1. The SDK's `supportedBetterAuthClientPlugins` list is exactly:
//      anonymous-token, better-auth-client, admin(-client), organization,
//      email-otp, magic-link, jwt. No two-factor. No passkey.
//   2. `grep -ric 'twoFactor|totp|backupCode|passkey|webauthn'` over the SDK's
//      three type-declaration bundles (next/index.d.mts, next/server/index.d.mts,
//      adapter-core.d.mts) returns 0 for every term.
//   3. The server helper's typed endpoint allowlist (`API_ENDPOINTS`, from which
//      `NeonAuthServer = Pick<VanillaBetterAuthClient, ServerAuthMethods>` is
//      derived) contains change-password, request-password-reset, reset-password,
//      send-verification-email, verify-email, list-sessions, revoke-session,
//      revoke-sessions, revoke-all-sessions, update-user, delete-user,
//      list-accounts, account-info — and NOT change-email, link-social, or
//      unlink-account.
//   4. neon.com/docs/auth/guides/plugins lists the supported plugins as Admin,
//      Email OTP, JWT, Magic Link, Organization, Open API, Phone Number.
//      neon.com/docs/auth/roadmap lists "MFA support" as "coming soon".
//   5. docs/platform-architecture-spec.md Part 2 already recorded the same
//      boundary from the IdP research ("doesn't yet support bringing your own
//      Better Auth plugins or custom server-side handlers").
//
// THE RULE THIS FILE EXISTS TO ENFORCE: never fake an unsupported capability.
// A surface for an `unavailable` capability must render an honest "not available
// yet" state and its action must fail closed — never a silent no-op that looks
// like success. `assertCapability` is the fail-closed helper.

import type { AuthCapabilityKey, AuthCapabilitySupport } from "@quagga/types";

export interface AuthCapability {
  key: AuthCapabilityKey;
  support: AuthCapabilitySupport;
  /**
   * The SDK method backing it, or null when nothing backs it. `server:` names
   * are on `createNeonAuth(...)`; `client:` names are on `createAuthClient()`.
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
    method: "server:changePassword",
    reason:
      "`change-password` is in the Neon Auth server endpoint allowlist; re-auth with the current password is enforced upstream.",
  },
  passwordReset: {
    key: "passwordReset",
    support: "supported",
    method: "server:requestPasswordReset + server:resetPassword",
    reason:
      "`request-password-reset` and `reset-password` are both in the server endpoint allowlist.",
  },
  emailVerification: {
    key: "emailVerification",
    support: "supported",
    method: "server:sendVerificationEmail + server:verifyEmail",
    reason:
      "`send-verification-email` and `verify-email` are both in the server endpoint allowlist.",
  },
  sessionList: {
    key: "sessionList",
    support: "supported",
    method: "server:listSessions",
    reason: "`list-sessions` is in the server endpoint allowlist.",
  },
  sessionRevoke: {
    key: "sessionRevoke",
    support: "supported",
    method: "server:revokeSession / revokeSessions / revokeOtherSessions",
    reason:
      "`revoke-session`, `revoke-sessions` and `revoke-all-sessions` are all in the server endpoint allowlist.",
  },
  accountDeletion: {
    key: "accountDeletion",
    support: "supported",
    method: "server:deleteUser",
    reason:
      "`delete-user` is in the server endpoint allowlist. Note this deletes the IDENTITY at the provider only — erasing our application rows is our own sanitization step, which runs first and is the POPIA-relevant one.",
  },
  linkedAccounts: {
    key: "linkedAccounts",
    support: "supported",
    method: "server:listAccounts + server:accountInfo",
    reason:
      "`list-accounts` and `account-info` are in the server endpoint allowlist — enough to SHOW linked sign-in methods and to enforce the last-method guard.",
  },
  emailChange: {
    key: "emailChange",
    support: "client_only",
    method: "client:changeEmail",
    reason:
      "The browser client exposes `changeEmail`, and the /api/auth/* proxy forwards arbitrary paths upstream — but `change-email` is absent from the server endpoint allowlist, and Better Auth gates it behind a server option (`user.changeEmail.enabled`) we cannot set on a managed instance. Whether the upstream instance accepts it is UNVERIFIABLE without a live NEON_AUTH_BASE_URL. Separately, Better Auth's own flow has no 48-hour revocation window, which the spec requires — so the request/confirm/revoke record is ours regardless (`email_change_requests`).",
    userMessage:
      "Changing your sign-in email isn't available yet. We'll switch it on once it's confirmed working — nothing has changed on your account.",
  },
  unlinkAccount: {
    key: "unlinkAccount",
    support: "client_only",
    method: "client:unlinkAccount",
    reason:
      "Exposed on the browser client but absent from the server endpoint allowlist, so we cannot perform or re-verify it server-side. The last-sign-in-method guard is enforced by us from `listAccounts` regardless of where the unlink is executed.",
    userMessage:
      "Unlinking a sign-in method isn't available yet. Your sign-in methods are unchanged.",
  },
  twoFactor: {
    key: "twoFactor",
    support: "unavailable",
    method: null,
    reason:
      "The two-factor plugin is not in Neon's supported plugin set and cannot be installed on a managed instance. Zero occurrences of `twoFactor`/`totp` anywhere in the SDK's type declarations. Neon's roadmap lists MFA as 'coming soon'.",
    userMessage:
      "Two-factor authentication isn't available on this account yet. It depends on a feature our sign-in provider hasn't shipped — we'll turn it on the day it lands.",
  },
  backupCodes: {
    key: "backupCodes",
    support: "unavailable",
    method: null,
    reason:
      "Backup codes ship inside the two-factor plugin; unavailable for the same reason.",
    userMessage:
      "Backup codes arrive with two-factor authentication, which isn't available yet.",
  },
  passkeys: {
    key: "passkeys",
    support: "unavailable",
    method: null,
    reason:
      "The passkey plugin is not in Neon's supported plugin set and does not appear on the roadmap. (The spec already queued passkeys as phase 2 — this confirms it is blocked on the provider, not on us.)",
    userMessage:
      "Passkeys aren't available on this account yet.",
  },
};

/** True when a capability has a server method we can call and trust. */
export function isCapabilitySupported(key: AuthCapabilityKey): boolean {
  return AUTH_CAPABILITIES[key].support === "supported";
}

/**
 * True when a capability is structurally impossible on our managed instance.
 * Surfaces MUST render an honest unavailable state for these, never a control
 * that appears to work.
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
 * the TOP of any server action touching an unsupported flow: it returns a
 * refusal the caller surfaces honestly, so the flow can never report success it
 * did not achieve.
 *
 * `client_only` capabilities are refused server-side on purpose — we will not
 * pretend a server action performed something only the browser might manage and
 * that we cannot verify.
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

// What our identity provider ACTUALLY supports (the capability matrix).
//
// As of the self-hosted migration (docs/auth-platform-spec.md) we run our OWN
// Better Auth (1.6.x), mounted in-process in each app by @quagga/auth against our
// own Neon database — NOT managed Neon Auth. Self-hosting removes the managed
// provider's fixed-subset limitation: every core email/password + session +
// account capability is now a real server call on `auth.api.*`, and change-email
// / unlink (which managed Neon omitted from its server allowlist) are ours.
//
// TWO-FACTOR AND PASSKEYS NOW SHIP. As of migration 0015 both Better Auth plugins
// (twoFactor — TOTP + encrypted backup codes; @better-auth/passkey — WebAuthn,
// rpID scoped to the apex) are wired into @quagga/auth, with their tables owned by
// @quagga/db. So `twoFactor`, `backupCodes` and `passkeys` are `supported` here —
// the account-security surface renders the REAL enrolment/management flows instead
// of the honest "not available yet" cards it showed while the plugins were
// pending. Neither factor is ever the ONLY way in (password/Google stays primary),
// so a lost authenticator or passkey is never a dead end — recovery is a password
// or a 2FA backup code.
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
  /**
   * PROVIDER SUPPORT IS NOT THE SAME AS A FINISHED FEATURE.
   *
   * `support` answers "can Better Auth do this?". This answers "have WE wired a
   * working end-to-end flow for it?". They came apart badly: change-email and
   * unlink are both `supported`, and both ship as permanently disabled buttons
   * whose tooltip read `cap.userMessage` — which is undefined on a supported
   * capability, so the control offered NO explanation at all, and
   * `CapabilityNotice` rendered null beside it. The spec meanwhile listed both
   * as shipped.
   *
   * Absent means wired. Set it, with a `pendingMessage`, for anything the UI
   * must still refuse.
   */
  pending?: true;
  /** Shown wherever a `pending` capability's control is disabled. */
  pendingMessage?: string;
}

/** The honest explanation for a control that is disabled because the flow is
 * unfinished — provider support notwithstanding. Empty string when it is not
 * pending, so a caller can drop it straight into a `title`. */
export function capabilityPendingMessage(cap: AuthCapability): string {
  return cap.pending ? (cap.pendingMessage ?? "Not available yet.") : "";
}

/** True when a capability should not be offered to a user yet, for any reason. */
export function capabilityIsUsable(cap: AuthCapability): boolean {
  return cap.support === "supported" && !cap.pending;
}

/** What a capability notice should say, or `label: null` for "say nothing". */
export interface CapabilityVerdict {
  label: string | null;
  message: string;
}

/**
 * Resolve a capability into the words a disabled control's notice shows. The
 * ONE place the two independent reasons a control can be refused — the provider
 * cannot do it, or we have not finished wiring it — are turned into one
 * sentence, so the org console and the supplier portal cannot invent a third
 * phrasing for the same refusal now that all three apps mount the account suite
 * (roadmap M4-21).
 *
 * `label: null` means there is genuinely nothing to say. Note the order: a
 * `supported` capability that is still `pending` DOES get a notice — that pair
 * is what previously rendered a disabled button beside no explanation at all.
 */
export function capabilityVerdict(cap: AuthCapability): CapabilityVerdict {
  const pending = capabilityPendingMessage(cap);
  const message = pending || cap.userMessage || "Not available yet.";
  if (capabilityIsUsable(cap)) return { label: null, message };
  return {
    label: cap.support === "supported" ? "Not finished yet" : "Not available yet",
    message,
  };
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
      "Self-hosting unlocks server-side change-email (`user.changeEmail.enabled` is set in @quagga/auth, with `sendChangeEmailVerification` wired to Resend) — it was ABSENT from managed Neon's server allowlist. Better Auth owns the identity-side token; the 48h revocation window and POPIA state machine stay ours in @quagga/core + `email_change_requests`. Committing the new address still requires an email provider to deliver the confirmation, so the user-facing flow is gated on RESEND_API_KEY. PENDING: the provider call is available but our flow is not finished — the three server actions have no caller and the confirm/revoke URLs have no route.",
    pending: true,
    // DON'T SEND PEOPLE TO A DOOR THAT ISN'T THERE. This used to end "Ask an
    // organiser to change it for you — they can do it from the console." They
    // cannot: the console's Accounts surface grants org ROLES and nothing else,
    // and the only code in the monorepo that writes `user.email` is
    // `confirmEmailChange`, which is the very flow this `pending` flag exists to
    // say is unfinished. So the copy sent a burner to a colleague to ask for
    // something neither of them could do, and the burner came away thinking the
    // failure was theirs.
    pendingMessage:
      "Changing your sign-in email isn't finished yet \u2014 and organisers can't do it from the console either, so nobody can change it for you right now. Your current address still signs you in, and it's still where security notices go.",
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
      "Self-hosting exposes `unlinkAccount` server-side (managed Neon omitted it). The last-sign-in-method guard is still enforced by us from `listUserAccounts` — a member can never unlink their only method. PENDING: nothing in the app calls it yet, so the control is disabled rather than pretending.",
    pending: true,
    // Same correction as `emailChange` above, and it mattered more here: this
    // copy named a COMPROMISED Google account as the reason to go and ask, which
    // is the moment someone most needs a true answer. Nothing in the console
    // unlinks a provider — `auth.api.unlinkAccount` has no caller anywhere in
    // the monorepo — so the organiser had nothing to offer and the burner lost
    // time believing help was on the way. What is actually true is that the
    // Google account itself is the thing that opens this door, so securing it
    // with Google is the control that works today.
    pendingMessage:
      "Disconnecting a sign-in method isn't available yet, and organisers can't do it from the console either \u2014 nobody can remove Google from this account today. If that Google account is compromised, securing it with Google is what stops it being used to sign in here.",
  },
  twoFactor: {
    key: "twoFactor",
    support: "supported",
    method:
      "authClient.twoFactor.enable/verifyTotp/disable + auth.api.enableTwoFactor",
    reason:
      "The `twoFactor` plugin (TOTP) is installed in @quagga/auth (migration 0015: `two_factor` table + `user.two_factor_enabled`). Enrolment is: enable (password-checked) → scan the QR / enter the setup key → verify a 6-digit code → 2FA switches on. The plugin's own account lockout (10 fails → 15 min) guards the verify endpoints, and sign-in issues a second-factor challenge once enabled.",
  },
  backupCodes: {
    key: "backupCodes",
    support: "supported",
    method:
      "authClient.twoFactor.generateBackupCodes + verifyBackupCode (backup codes issued at 2FA enrolment)",
    reason:
      "Backup codes ship inside the `twoFactor` plugin and are stored ENCRYPTED (backupCodeOptions.storeBackupCodes:'encrypted' in @quagga/auth — never plaintext). Ten single-use codes are shown once at enrolment, downloadable, and regenerable; one satisfies the sign-in second-factor challenge when the authenticator is lost.",
  },
  passkeys: {
    key: "passkeys",
    support: "supported",
    method:
      "authClient.passkey.addPasskey / signIn.passkey + auth.api.listPasskeys/deletePasskey",
    reason:
      "The `@better-auth/passkey` plugin is installed in @quagga/auth (migration 0015: `passkey` table). rpID is scoped to the apex (quagga.ryanjnoble.dev) so one passkey works across app./org./suppliers. Passkeys are ADDITIVE — an accelerator on top of password/Google, never the only way in — so a lost passkey is never a lockout (recovery: password or a 2FA backup code).",
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

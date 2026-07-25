// Security notifications & emails (docs/accounts-security-spec.md §"Security
// notifications"). Two outputs from one set of facts:
//   - an in-app `security`-kind notification row (the existing inbox), and
//   - a Resend email body (the env-less seam in each app's lib/email.ts — it
//     delivers when RESEND_API_KEY is set and logs to the console otherwise).
//
// PURITY CONTRACT: builders only. No I/O, no env, no send. The app decides
// whether to send; this module decides what it says.
//
// PRIVACY LAW (same as ./notifications): a security message names WHAT changed
// and WHEN, never a secret and never a hard-locked private field. It carries no
// password, no token, no full session id, and no IP address beyond the coarse
// location string the provider already shows the account holder about their own
// sessions. `securityMessageLeaks` is the test-facing guard.
//
// THE RULE THAT MATTERS MOST: a notification is a statement of fact. Never emit
// a "changed" message for something that did not change. Where a provider
// capability is missing (see ./auth-capabilities), the flow fails closed and no
// notification is emitted at all — a false "your email was changed" is worse
// than no email, because it teaches the burner to ignore the real one.

import type { NotificationPayload, SecurityEventKind } from "@quagga/types";

// --- In-app notification builders -----------------------------------------

/** Where the account surfaces live, so links stay consistent across apps. */
export const ACCOUNT_SECURITY_PATH = "/account/security";
export const ACCOUNT_PATH = "/account";

/** 🔐 The account password was changed (by the holder, from a signed-in session). */
export function passwordChangedNotification(): NotificationPayload {
  return {
    kind: "security",
    title: "Your password was changed",
    body: "If this wasn't you, reset your password immediately and review your active sessions.",
    link: ACCOUNT_SECURITY_PATH,
  };
}

/** 🔐 A password reset completed via an emailed link. All sessions were ended. */
export function passwordResetCompletedNotification(): NotificationPayload {
  return {
    kind: "security",
    title: "Your password was reset",
    body: "Every signed-in device was signed out. If this wasn't you, contact AfrikaBurn.",
    link: ACCOUNT_SECURITY_PATH,
  };
}

/**
 * 🔐 An email change was REQUESTED. Goes to the account's inbox; the OLD address
 * separately receives the revocation email. Deliberately does not assert that
 * anything has changed yet.
 */
export function emailChangeRequestedNotification(input: {
  newEmailMasked: string;
}): NotificationPayload {
  return {
    kind: "security",
    title: `A change of sign-in email to ${input.newEmailMasked} was requested`,
    body: "Nothing has changed yet — the new address has to confirm it first. If this wasn't you, use the link we emailed your current address to stop it.",
    link: ACCOUNT_PATH,
  };
}

/** 🔐 The change completed AND the provider applied it. Only ever sent on truth. */
export function emailChangeCompletedNotification(input: {
  newEmailMasked: string;
}): NotificationPayload {
  return {
    kind: "security",
    title: `Your sign-in email is now ${input.newEmailMasked}`,
    body: "If this wasn't you, contact AfrikaBurn straight away — you have 48 hours to reverse it from the link sent to your previous address.",
    link: ACCOUNT_PATH,
  };
}

/** 🔐 The old address pulled the change back inside the 48h window. */
export function emailChangeRevokedNotification(): NotificationPayload {
  return {
    kind: "security",
    title: "The change to your sign-in email was reversed",
    body: "Your email is back to what it was. We'd recommend changing your password too.",
    link: ACCOUNT_SECURITY_PATH,
  };
}

/**
 * 🔐 A sign-in from a device we have not seen on this account. Only emitted when
 * the session list actually gives us a new device fingerprint — never guessed.
 */
export function newDeviceSignInNotification(input: {
  deviceLabel: string;
  approximateLocation?: string | null;
}): NotificationPayload {
  const where = input.approximateLocation
    ? ` from ${input.approximateLocation}`
    : "";
  return {
    kind: "security",
    title: `New sign-in on ${input.deviceLabel}${where}`,
    body: "If that wasn't you, revoke the session and change your password.",
    link: ACCOUNT_SECURITY_PATH,
  };
}

/** 🔐 Account deletion requested — the grace period is running. */
export function deletionRequestedNotification(input: {
  daysRemaining: number;
}): NotificationPayload {
  return {
    kind: "security",
    title: "Your account is scheduled for deletion",
    body: `You have ${input.daysRemaining} days to change your mind — just sign in and it's cancelled. After that your personal details are erased permanently.`,
    link: "/account/delete",
  };
}

/** 🔐 The burner came back (or cancelled explicitly). */
export function deletionCancelledNotification(): NotificationPayload {
  return {
    kind: "security",
    title: "Your account deletion was cancelled",
    body: "Welcome back — nothing was erased.",
    link: ACCOUNT_PATH,
  };
}

/**
 * 🔐 Sanitization has run. Written to the inbox for the audit trail's sake, but
 * the EMAIL is the meaningful delivery — the account can no longer sign in to
 * read an inbox.
 */
export function deletionCompletedNotification(): NotificationPayload {
  return {
    kind: "security",
    title: "Your account has been deleted",
    body: "Your personal details have been erased. Records that had to stay (camp memberships, questionnaire answers) are now anonymous.",
    link: null,
  };
}

// --- Resend email bodies --------------------------------------------------

export interface SecurityEmail {
  kind: SecurityEventKind;
  subject: string;
  /** Plain text. lib/email.ts derives the HTML when none is supplied. */
  text: string;
}

const SIGN_OFF =
  "\n\nIf you didn't do this, reply to this email or contact AfrikaBurn — we'd rather hear from you twice than not at all.\n\n— AfrikaBurn Contributors";

/**
 * Mask an email for display: keep the first character of the local part and the
 * full domain (`alice@example.com` → `a…@example.com`). Security notices have to
 * identify an address well enough to be actionable without printing it in full
 * into an inbox that may not be the account holder's.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const first = [...local][0] ?? "";
  return `${first}…${domain}`;
}

/** Password changed from a signed-in session. */
export function passwordChangedEmail(input: {
  when: Date;
}): SecurityEmail {
  return {
    kind: "password_changed",
    subject: "Your AfrikaBurn password was changed",
    text: `Your password was changed on ${formatWhen(input.when)}.${SIGN_OFF}`,
  };
}

/** Password reset completed via an emailed link; all sessions ended. */
export function passwordResetCompletedEmail(input: {
  when: Date;
}): SecurityEmail {
  return {
    kind: "password_reset_completed",
    subject: "Your AfrikaBurn password was reset",
    text: `Your password was reset on ${formatWhen(
      input.when,
    )}, and every signed-in device was signed out.${SIGN_OFF}`,
  };
}

/**
 * To the NEW address: confirm the change. This is the only security email that
 * carries a link the recipient must act on to make something happen.
 */
export function emailChangeConfirmEmail(input: {
  confirmUrl: string;
  expiresInHours: number;
}): SecurityEmail {
  return {
    kind: "email_change_requested",
    subject: "Confirm your new AfrikaBurn sign-in email",
    text:
      `Someone asked to use this address to sign in to AfrikaBurn Contributors.\n\n` +
      `Confirm it here (the link works once, and expires in ${input.expiresInHours} hours):\n${input.confirmUrl}\n\n` +
      `If you weren't expecting this, ignore this email — nothing will change.\n\n— AfrikaBurn Contributors`,
  };
}

/**
 * To the OLD address: notify + offer revocation. Sent at REQUEST time, so the
 * account holder can stop a change they didn't ask for before it completes.
 */
export function emailChangeNotifyOldEmail(input: {
  newEmailMasked: string;
  revokeUrl: string;
  revocationHours: number;
}): SecurityEmail {
  return {
    kind: "email_change_requested",
    subject: "A change to your AfrikaBurn sign-in email was requested",
    text:
      `Someone asked to move this account's sign-in email to ${input.newEmailMasked}.\n\n` +
      `Nothing changes until that address confirms it. If this wasn't you — or you change your mind — stop or reverse it here, for up to ${input.revocationHours} hours after it completes:\n${input.revokeUrl}\n\n` +
      `We'd also recommend changing your password.\n\n— AfrikaBurn Contributors`,
  };
}

/** To the OLD address once the change actually took effect at the provider. */
export function emailChangeCompletedEmail(input: {
  newEmailMasked: string;
  revokeUrl: string;
  revocationHours: number;
}): SecurityEmail {
  return {
    kind: "email_change_completed",
    subject: "Your AfrikaBurn sign-in email was changed",
    text:
      `This account now signs in with ${input.newEmailMasked}.\n\n` +
      `You have ${input.revocationHours} hours to reverse this:\n${input.revokeUrl}${SIGN_OFF}`,
  };
}

/** The change was pulled back inside the window. */
export function emailChangeRevokedEmail(): SecurityEmail {
  return {
    kind: "email_change_revoked",
    subject: "The change to your AfrikaBurn sign-in email was reversed",
    text:
      `Your sign-in email is back to this address.\n\n` +
      `Because someone tried to move it, we'd strongly recommend changing your password now.${SIGN_OFF}`,
  };
}

/** A sign-in from a device not previously seen on the account. */
export function newDeviceSignInEmail(input: {
  deviceLabel: string;
  approximateLocation?: string | null;
  when: Date;
}): SecurityEmail {
  const where = input.approximateLocation ? ` near ${input.approximateLocation}` : "";
  return {
    kind: "new_device_sign_in",
    subject: "New sign-in to your AfrikaBurn account",
    text: `Your account was signed in on ${input.deviceLabel}${where} at ${formatWhen(
      input.when,
    )}.\n\nYou can review and end sessions under Account → Security.${SIGN_OFF}`,
  };
}

/** Deletion requested — the grace period is running and how to stop it. */
export function deletionRequestedEmail(input: {
  daysRemaining: number;
  graceEndsAt: Date;
}): SecurityEmail {
  return {
    kind: "deletion_requested",
    subject: "Your AfrikaBurn account is scheduled for deletion",
    text:
      `We've scheduled this account for deletion on ${formatWhen(input.graceEndsAt)}.\n\n` +
      `You have ${input.daysRemaining} days to change your mind. Signing in is enough — that cancels it, no forms.\n\n` +
      `After that, your personal details are erased permanently. Records that have to stay — camp memberships, questionnaire answers, the audit trail — remain, but with nothing personal attached to them.${SIGN_OFF}`,
  };
}

/** Deletion cancelled. */
export function deletionCancelledEmail(): SecurityEmail {
  return {
    kind: "deletion_cancelled",
    subject: "Your AfrikaBurn account deletion was cancelled",
    text: `Welcome back. Nothing was erased and your account is exactly as you left it.\n\n— AfrikaBurn Contributors`,
  };
}

/**
 * Sanitization has run. Sent to the address ON RECORD AT REQUEST TIME, captured
 * before erasure — after sanitization there is no address left to send to.
 */
export function deletionCompletedEmail(): SecurityEmail {
  return {
    kind: "deletion_completed",
    subject: "Your AfrikaBurn account has been deleted",
    text:
      `Your personal details have been erased.\n\n` +
      `What's left is anonymous: camp memberships, questionnaire answers and audit records still exist so the projects you were part of keep their history, but nothing in them identifies you.\n\n` +
      `This is the last email we'll send to this address.\n\n— AfrikaBurn Contributors`,
  };
}

/** ISO-ish, timezone-explicit, no locale surprises in a security notice. */
function formatWhen(when: Date): string {
  return `${when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// --- Test-facing guards ---------------------------------------------------

/**
 * True when a security message contains any of the forbidden values (a password,
 * a raw token, a hard-locked private field). Mirrors `notificationMentionsAny`;
 * the regression tests run every builder's output through it.
 */
export function securityMessageLeaks(
  message: SecurityEmail | NotificationPayload,
  forbidden: readonly (string | null | undefined)[],
): boolean {
  const needles = forbidden
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.toLowerCase());
  if (needles.length === 0) return false;
  const haystack = JSON.stringify(message).toLowerCase();
  return needles.some((n) => haystack.includes(n));
}

"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  assertCapability,
  assessPassword,
  assessDeletionEligibility,
  canCancelDeletion,
  canConfirmEmailChange,
  canRevokeEmailChange,
  deletionGraceEndsAt,
  deletionRequestedEmail,
  deletionCancelledEmail,
  deletionRequestedNotification,
  deletionCancelledNotification,
  emailChangeConfirmEmail,
  emailChangeExpiresAt,
  emailChangeNotifyOldEmail,
  emailChangeRequestedNotification,
  emailChangeRevocableUntil,
  emailChangeRevokedEmail,
  emailChangeRevokedNotification,
  enumerationSafeMessage,
  maskEmail,
  passwordChangedEmail,
  passwordChangedNotification,
  passwordResetCompletedEmail,
  passwordResetCompletedNotification,
  DELETION_GRACE_PERIOD_DAYS,
  EMAIL_CHANGE_CONFIRM_TTL_HOURS,
  EMAIL_CHANGE_REVOCATION_HOURS,
  type NotificationPayload,
} from "@quagga/core";

import { auth } from "@/lib/neon-auth";
import { db, schema } from "@/lib/db";
import { isAuthConfigured, isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { insertNotifications } from "@/lib/notifications";
import { buildDeletionGuardContext, getDeletionRequest } from "@/lib/account";
import { hashToken, newToken } from "@/lib/account-tokens";

// Write side of the account surfaces (docs/accounts-security-spec.md).
//
// THE HONESTY RULE, enforced everywhere below: never report success for
// something that did not happen. Where the managed Neon Auth instance does not
// expose a capability (see @quagga/core AUTH_CAPABILITIES), the action refuses
// via `assertCapability` and says so plainly — it never silently no-ops, and it
// never emits a "your X was changed" notification for a change that did not
// occur. A false security notification is worse than none: it trains people to
// ignore the real one.
//
// Every action re-resolves the session server-side; nothing trusts a client id.

export type AccountActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function run(
  fn: () => Promise<{ message?: string } | void>,
): Promise<AccountActionResult> {
  try {
    const out = await fn();
    return { ok: true, message: out?.message };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Something went wrong. Try again.",
    };
  }
}

/** Best-effort security notification: an inbox row plus a Resend email. */
async function notifySecurity(
  userId: string,
  email: string | null,
  payload: NotificationPayload,
  mail: { subject: string; text: string } | null,
): Promise<void> {
  try {
    await insertNotifications(db(), [{ userId, ...payload }]);
  } catch {
    // A failed inbox write must not roll back a completed security change.
  }
  if (mail && email) {
    try {
      await sendEmail({ to: email, subject: mail.subject, text: mail.text });
    } catch {
      // Same: the change already happened; delivery is best-effort.
    }
  }
}

// --- Password -------------------------------------------------------------

const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string(),
  /** Sign every other device out — recommended, and the default in the UI. */
  revokeOtherSessions: z.boolean().default(true),
});

/**
 * Change the password from a signed-in session. Backed by the provider's
 * `change-password` endpoint (SUPPORTED), which re-authenticates with the
 * current password upstream — we never verify a password ourselves.
 *
 * Policy is enforced here before the call so the burner gets our message, not
 * the provider's: 15+ characters, no composition rules, no confirm-twice field.
 */
export async function changePassword(
  raw: z.input<typeof ChangePasswordInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = ChangePasswordInput.parse(raw);

    if (!isAuthConfigured()) {
      throw new Error("Sign-in isn't configured yet, so passwords can't change.");
    }

    const assessment = assessPassword(input.newPassword);
    if (!assessment.ok) throw new Error(assessment.error ?? "That password won't do.");

    const { error } = await auth.changePassword({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: input.revokeOtherSessions,
    });
    // Fail CLOSED: if the provider refused, nothing changed, so nothing is
    // announced. The message stays generic — a precise upstream error is a
    // credential oracle.
    if (error) {
      throw new Error(
        "That didn't work. Check your current password and try again.",
      );
    }

    await notifySecurity(
      user.id,
      user.email,
      passwordChangedNotification(),
      passwordChangedEmail({ when: new Date() }),
    );

    revalidatePath("/account/security");
    return { message: "Password changed." };
  });
}

const RequestPasswordResetInput = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().trim().max(512).optional(),
});

/**
 * Start a password reset. Backed by `request-password-reset` (SUPPORTED).
 *
 * ENUMERATION-SAFE: the same message ships whether or not the account exists,
 * and the provider's outcome is deliberately discarded rather than surfaced.
 * The `void error` below is the point, not an oversight.
 */
export async function requestPasswordReset(
  raw: z.input<typeof RequestPasswordResetInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const input = RequestPasswordResetInput.parse(raw);
    if (isAuthConfigured()) {
      const { error } = await auth.requestPasswordReset({
        email: input.email,
        redirectTo: input.redirectTo ?? "/auth/reset-password",
      });
      void error;
    }
    return { message: enumerationSafeMessage("forgot_password") };
  });
}

const ResetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: z.string(),
});

/**
 * Complete a password reset from an emailed link. Backed by `reset-password`
 * (SUPPORTED); the provider invalidates all sessions on success.
 */
export async function resetPassword(
  raw: z.input<typeof ResetPasswordInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const input = ResetPasswordInput.parse(raw);
    if (!isAuthConfigured()) {
      throw new Error("Sign-in isn't configured yet.");
    }

    const assessment = assessPassword(input.newPassword);
    if (!assessment.ok) throw new Error(assessment.error ?? "That password won't do.");

    const { error } = await auth.resetPassword({
      token: input.token,
      newPassword: input.newPassword,
    });
    if (error) {
      throw new Error(
        "That reset link has expired or has already been used. Request a new one.",
      );
    }

    // The account is identified by the token, not by a session — so the
    // notification is written by the sign-in that follows, where we know who it
    // is. What we CAN do here is nothing that pretends otherwise.
    return { message: "Password reset. Sign in with your new password." };
  });
}

/**
 * Post-reset notification, called once the reset-er signs back in. Split out so
 * the reset action never has to guess an identity it doesn't hold.
 */
export async function notifyPasswordResetCompleted(): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    await notifySecurity(
      user.id,
      user.email,
      passwordResetCompletedNotification(),
      passwordResetCompletedEmail({ when: new Date() }),
    );
  });
}

// --- Sessions -------------------------------------------------------------

const RevokeSessionInput = z.object({ token: z.string().min(1) });

/** Revoke one session. Backed by `revoke-session` (SUPPORTED). */
export async function revokeSession(
  raw: z.input<typeof RevokeSessionInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    await requireCampUser();
    const input = RevokeSessionInput.parse(raw);
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");

    // The provider scopes revocation to the CALLING session's user, so a forged
    // token from another account cannot be revoked through our session.
    const { error } = await auth.revokeSession({ token: input.token });
    if (error) throw new Error("That session couldn't be ended. Try again.");

    revalidatePath("/account/security");
    return { message: "Session ended." };
  });
}

/**
 * Revoke every OTHER session, keeping the current one. Backed by
 * `revoke-all-sessions` (SUPPORTED). Deliberately not "revoke all" — signing
 * yourself out while trying to secure your account is a hostile outcome.
 */
export async function revokeOtherSessions(): Promise<AccountActionResult> {
  return run(async () => {
    await requireCampUser();
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");
    const { error } = await auth.revokeOtherSessions();
    if (error) throw new Error("Those sessions couldn't be ended. Try again.");
    revalidatePath("/account/security");
    return { message: "Every other device has been signed out." };
  });
}

// --- Email change ---------------------------------------------------------

const RequestEmailChangeInput = z.object({
  newEmail: z.string().trim().email(),
});

/**
 * Request a change of sign-in email. Records the request, emails the NEW address
 * a single-use confirmation link, and emails the OLD address a revocation link.
 *
 * WHY THIS IS OURS. Managed Neon Auth's server SDK exposes no `change-email`
 * endpoint, and Better Auth's own flow has no 48-hour revocation window, which
 * the spec requires. So the request/confirm/revoke record lives in
 * `email_change_requests` — but the FINAL step (applying the address at the
 * identity provider) is gated by `assertCapability("emailChange")` in
 * `confirmEmailChange`, and currently refuses. That means this request is
 * genuinely recorded and genuinely revocable, and the burner is told plainly
 * that the switch itself isn't live yet. The alternative — accepting the request
 * and reporting a change that never happened — is the exact failure mode this
 * codebase refuses.
 *
 * ENUMERATION-SAFE: the same message ships whether or not the target address is
 * already in use.
 */
export async function requestEmailChange(
  raw: z.input<typeof RequestEmailChangeInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = RequestEmailChangeInput.parse(raw);
    if (!isDatabaseConfigured()) throw new Error("The database isn't configured yet.");

    const currentEmail = user.email;
    if (!currentEmail) {
      throw new Error("This account has no email on record to change.");
    }
    if (currentEmail.toLowerCase() === input.newEmail.toLowerCase()) {
      throw new Error("That's already your sign-in email.");
    }

    const now = new Date();
    const handle = db();

    // Supersede any request still awaiting confirmation — the partial unique
    // index allows exactly one `pending` row per user.
    await handle
      .update(schema.emailChangeRequests)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(schema.emailChangeRequests.userId, user.id),
          eq(schema.emailChangeRequests.status, "pending"),
        ),
      );

    const confirmToken = newToken();
    const revokeToken = newToken();

    await handle.insert(schema.emailChangeRequests).values({
      userId: user.id,
      currentEmail,
      newEmail: input.newEmail,
      status: "pending",
      confirmTokenHash: hashToken(confirmToken),
      revokeTokenHash: hashToken(revokeToken),
      expiresAt: emailChangeExpiresAt(now),
    });

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const confirm = emailChangeConfirmEmail({
      confirmUrl: `${base}/account/email/confirm?token=${confirmToken}`,
      expiresInHours: EMAIL_CHANGE_CONFIRM_TTL_HOURS,
    });
    const notifyOld = emailChangeNotifyOldEmail({
      newEmailMasked: maskEmail(input.newEmail),
      revokeUrl: `${base}/account/email/revoke?token=${revokeToken}`,
      revocationHours: EMAIL_CHANGE_REVOCATION_HOURS,
    });

    await sendEmail({
      to: input.newEmail,
      subject: confirm.subject,
      text: confirm.text,
    });
    await notifySecurity(
      user.id,
      currentEmail,
      emailChangeRequestedNotification({
        newEmailMasked: maskEmail(input.newEmail),
      }),
      notifyOld,
    );

    revalidatePath("/account");
    return { message: enumerationSafeMessage("email_change_request") };
  });
}

const TokenInput = z.object({ token: z.string().min(1) });

/**
 * Confirm a change from the NEW address's link.
 *
 * FAILS CLOSED, by design. The token is verified and the window logic is sound,
 * but applying the address at the identity provider is a `client_only`
 * capability we cannot perform or verify server-side — so the row is NOT marked
 * confirmed and no "your email changed" notification is emitted. The burner gets
 * the honest capability message. The moment Neon exposes `change-email`
 * server-side, the guard below flips to `supported` in one place
 * (@quagga/core AUTH_CAPABILITIES) and the commit lands here.
 */
export async function confirmEmailChange(
  raw: z.input<typeof TokenInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = TokenInput.parse(raw);
    if (!isDatabaseConfigured()) throw new Error("The database isn't configured yet.");

    const now = new Date();
    const [request] = await db()
      .select({
        id: schema.emailChangeRequests.id,
        status: schema.emailChangeRequests.status,
        expiresAt: schema.emailChangeRequests.expiresAt,
        confirmedAt: schema.emailChangeRequests.confirmedAt,
        revocableUntil: schema.emailChangeRequests.revocableUntil,
        revokedAt: schema.emailChangeRequests.revokedAt,
        providerCommittedAt: schema.emailChangeRequests.providerCommittedAt,
      })
      .from(schema.emailChangeRequests)
      .where(
        and(
          eq(schema.emailChangeRequests.userId, user.id),
          eq(schema.emailChangeRequests.confirmTokenHash, hashToken(input.token)),
        ),
      )
      .limit(1);

    // One message for "no such token" and "wrong state" — a token oracle is a
    // token oracle whichever way it leaks.
    if (!request || !canConfirmEmailChange(request, now)) {
      throw new Error("That link has expired or has already been used.");
    }

    const capability = assertCapability("emailChange");
    if (!capability.ok) {
      // Nothing is marked confirmed, nothing is announced, nothing is implied.
      throw new Error(capability.message);
    }

    // Reached only once the provider supports a server-side commit. The address
    // is applied FIRST; only a real success writes `providerCommittedAt`, which
    // is what `isEmailChangeEffective` reads.
    const confirmedAt = now;
    await db()
      .update(schema.emailChangeRequests)
      .set({
        status: "confirmed",
        confirmedAt,
        revocableUntil: emailChangeRevocableUntil(confirmedAt),
        providerCommittedAt: confirmedAt,
        updatedAt: now,
      })
      .where(eq(schema.emailChangeRequests.id, request.id));

    revalidatePath("/account");
    return { message: "Your sign-in email has been updated." };
  });
}

/**
 * Revoke a change from the OLD address's link, inside the 48h window. Available
 * to an UNAUTHENTICATED caller on purpose: the whole point is that someone who
 * has lost control of their account can pull the change back from their email.
 */
export async function revokeEmailChange(
  raw: z.input<typeof TokenInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const input = TokenInput.parse(raw);
    if (!isDatabaseConfigured()) throw new Error("The database isn't configured yet.");

    const now = new Date();
    const handle = db();
    const [request] = await handle
      .select({
        id: schema.emailChangeRequests.id,
        userId: schema.emailChangeRequests.userId,
        currentEmail: schema.emailChangeRequests.currentEmail,
        status: schema.emailChangeRequests.status,
        expiresAt: schema.emailChangeRequests.expiresAt,
        confirmedAt: schema.emailChangeRequests.confirmedAt,
        revocableUntil: schema.emailChangeRequests.revocableUntil,
        revokedAt: schema.emailChangeRequests.revokedAt,
        providerCommittedAt: schema.emailChangeRequests.providerCommittedAt,
      })
      .from(schema.emailChangeRequests)
      .where(eq(schema.emailChangeRequests.revokeTokenHash, hashToken(input.token)))
      .orderBy(desc(schema.emailChangeRequests.createdAt))
      .limit(1);

    if (!request) throw new Error("That link is no longer valid.");

    // A still-pending request can be STOPPED outright (nothing has happened
    // yet); a confirmed one can be REVERSED inside the window.
    const pending = request.status === "pending";
    if (!pending && !canRevokeEmailChange(request, now)) {
      throw new Error(
        "That link is no longer valid — the 48-hour window to reverse this has passed.",
      );
    }

    await handle
      .update(schema.emailChangeRequests)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(eq(schema.emailChangeRequests.id, request.id));

    await notifySecurity(
      request.userId,
      request.currentEmail,
      emailChangeRevokedNotification(),
      emailChangeRevokedEmail(),
    );

    revalidatePath("/account");
    return {
      message: pending
        ? "Stopped. Your sign-in email is unchanged."
        : "Reversed. Your sign-in email is back to what it was.",
    };
  });
}

// --- Deletion -------------------------------------------------------------

const RequestDeletionInput = z.object({
  /** Re-auth: the account password, verified upstream by re-signing in. */
  password: z.string().min(1, "Enter your password to confirm."),
});

/**
 * Request account deletion. Re-authenticates, runs the three guards, then starts
 * the 14-day grace period. Nothing is erased here — see `sanitizeAccount`.
 *
 * Guards (all in @quagga/core, all server-side):
 *  - a sole camp lead must transfer leadership first;
 *  - the sole org god cannot self-delete;
 *  - an account with no usable sign-in method can't prove it's them.
 */
export async function requestAccountDeletion(
  raw: z.input<typeof RequestDeletionInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = RequestDeletionInput.parse(raw);
    if (!isDatabaseConfigured()) throw new Error("The database isn't configured yet.");
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");
    if (!user.email) throw new Error("This account has no email on record.");

    // Re-auth. Deleting an account is the most destructive thing a session can
    // do, so a stolen session alone must not be enough.
    //
    // We re-authenticate by signing in as the same account rather than by a
    // dedicated verify-password endpoint, because the managed instance exposes
    // no such endpoint. Side effect: this establishes a fresh session for the
    // SAME user. Harmless (no privilege change, no other account involved), but
    // worth knowing when reading the session list right after.
    const { error: reauthError } = await auth.signIn.email({
      email: user.email,
      password: input.password,
    });
    if (reauthError) throw new Error("That password didn't match. Try again.");

    const eligibility = assessDeletionEligibility(
      await buildDeletionGuardContext(user.id),
    );
    if (!eligibility.ok) {
      throw new Error(eligibility.blocks.map((b) => b.message).join(" "));
    }

    const existing = await getDeletionRequest(user.id);
    if (existing) {
      throw new Error("This account is already scheduled for deletion.");
    }

    const now = new Date();
    const graceEndsAt = deletionGraceEndsAt(now);

    await db().insert(schema.accountDeletionRequests).values({
      userId: user.id,
      status: "pending",
      requestedAt: now,
      graceEndsAt,
      requestedFromApp: "web",
    });

    await db().insert(schema.auditEvents).values({
      actorId: user.id,
      action: "account.deletion_requested",
      subject: user.id,
      meta: { graceEndsAt: graceEndsAt.toISOString(), app: "web" },
    });

    await notifySecurity(
      user.id,
      user.email,
      deletionRequestedNotification({ daysRemaining: DELETION_GRACE_PERIOD_DAYS }),
      deletionRequestedEmail({
        daysRemaining: DELETION_GRACE_PERIOD_DAYS,
        graceEndsAt,
      }),
    );

    revalidatePath("/account/delete");
    return {
      message: `Scheduled. You have ${DELETION_GRACE_PERIOD_DAYS} days to change your mind — just sign in.`,
    };
  });
}

/**
 * Cancel a pending deletion. Called explicitly from /account/delete, and
 * implicitly by `cancelDeletionOnSignInFor` on every sign-in.
 */
export async function cancelAccountDeletion(): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const cancelled = await cancelDeletionOnSignInFor(user.id, user.email);
    if (!cancelled) throw new Error("There's no deletion scheduled on this account.");
    revalidatePath("/account/delete");
    return { message: "Cancelled — nothing was erased." };
  });
}

/**
 * The sign-in hook: coming back cancels a running deletion, exactly as the spec
 * promises ("cancelable by simply signing in"). Safe to call on every sign-in —
 * it no-ops when there is nothing pending.
 *
 * A request whose grace has ALREADY elapsed is deliberately not rescued here:
 * @quagga/core `cancelDeletionOnSignIn` refuses it, so a login cannot race the
 * sweeper into an ambiguous half-deleted state.
 */
export async function cancelDeletionOnSignInFor(
  userId: string,
  email: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const request = await getDeletionRequest(userId);
  if (!request || !canCancelDeletion(request, now)) return false;

  await db()
    .update(schema.accountDeletionRequests)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.accountDeletionRequests.id, request.id),
        eq(schema.accountDeletionRequests.status, "pending"),
      ),
    );

  await db().insert(schema.auditEvents).values({
    actorId: userId,
    action: "account.deletion_cancelled",
    subject: userId,
    meta: { via: "sign_in" },
  });

  await notifySecurity(
    userId,
    email,
    deletionCancelledNotification(),
    deletionCancelledEmail(),
  );
  return true;
}

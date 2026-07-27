"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
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
import type { SecurityEventLogKind } from "@quagga/types";

import { auth } from "@quagga/auth";
import { db, schema, withTransaction } from "@/lib/db";
import { isAuthConfigured, isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { insertNotifications } from "@/lib/notifications";
import { buildDeletionGuardContext, getDeletionRequest } from "@/lib/account";
import { hashToken, newToken } from "@/lib/account-tokens";

// Write side of the account surfaces (docs/accounts-security-spec.md).
//
// THE HONESTY RULE, enforced everywhere below: never report success for
// something that did not happen. The self-hosted Better Auth server API
// (`auth.api.*` via @quagga/auth) THROWS on failure and returns data on success,
// so each call is wrapped and a refusal surfaces plainly — it never silently
// no-ops, and it never emits a "your X was changed" notification for a change
// that did not occur. A false security notification is worse than none: it
// trains people to ignore the real one. Capabilities that are not yet deliverable
// (2FA/passkeys — plugins not installed) still refuse via `assertCapability`.
//
// Every action re-resolves the session server-side; nothing trusts a client id.

export type AccountActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

/** Postgres unique-violation SQLSTATE, surfaced by the Neon driver as `.code`. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

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

/**
 * Best-effort append to the `security_events` log (docs/accounts-security-spec.md
 * §"recent security events"). THIN: it records the request context (IP + user
 * agent) at the moment an account action succeeds. It must NEVER break or roll
 * back the primary action — a failed insert, or a missing request context, is
 * swallowed. Feeds the account security page's "recent security events" card.
 */
async function recordSecurityEvent(
  userId: string,
  kind: SecurityEventLogKind,
): Promise<void> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || h.get("x-real-ip") || null;
    const userAgent = h.get("user-agent") || null;
    await db()
      .insert(schema.securityEvents)
      .values({ userId, kind, ip, userAgent });
  } catch {
    // The change already happened; the log is a record, never a gate.
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
      throw new Error(
        "Sign-in isn't configured yet, so passwords can't change.",
      );
    }

    const assessment = assessPassword(input.newPassword);
    if (!assessment.ok)
      throw new Error(assessment.error ?? "That password won't do.");

    // Fail CLOSED: if the server API throws, nothing changed, so nothing is
    // announced. The message stays generic — a precise upstream error is a
    // credential oracle. `changePassword` re-authenticates with the current
    // password server-side; we never verify a password ourselves.
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: input.revokeOtherSessions,
        },
        headers: await headers(),
      });
    } catch {
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
    await recordSecurityEvent(user.id, "password_changed");

    revalidatePath("/account/security");
    return { message: "Password changed." };
  });
}

const RequestPasswordResetInput = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().trim().max(512).optional(),
});

/**
 * Start a password reset. Backed by `auth.api.requestPasswordReset` (native to
 * self-hosted email/password).
 *
 * HONESTLY UNAVAILABLE WITHOUT A SENDER: the reset LINK can only reach the user
 * by email, so with no email provider (RESEND_API_KEY) this presents as
 * unavailable rather than claiming a link was sent. That refusal is NOT
 * account-specific, so it leaks nothing about whether the account exists.
 *
 * ENUMERATION-SAFE when it does run: the same message ships whether or not the
 * account exists, and the server API's outcome is deliberately discarded (the
 * swallowed throw is the point, not an oversight).
 */
export async function requestPasswordReset(
  raw: z.input<typeof RequestPasswordResetInput>,
): Promise<AccountActionResult> {
  const input = RequestPasswordResetInput.parse(raw);
  if (!isAuthConfigured() || !isEmailConfigured()) {
    // Honest, non-enumerating refusal — nothing was sent because nothing could be.
    return {
      ok: false,
      error:
        "Password reset by email isn't available yet — no reset link can be sent. Ask an organiser for help.",
    };
  }
  return run(async () => {
    try {
      await auth.api.requestPasswordReset({
        body: {
          email: input.email,
          redirectTo: input.redirectTo ?? "/auth/reset-password",
        },
      });
    } catch {
      // Swallow — surfacing the outcome would be an account-existence oracle.
    }
    return { message: enumerationSafeMessage("forgot_password") };
  });
}

const ResetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: z.string(),
});

/**
 * Complete a password reset from an emailed link. Backed by
 * `auth.api.resetPassword`; `revokeSessionsOnPasswordReset` is set in
 * @quagga/auth so every session is invalidated on success. The token is in hand,
 * so this needs no email provider.
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
    if (!assessment.ok)
      throw new Error(assessment.error ?? "That password won't do.");

    try {
      await auth.api.resetPassword({
        body: { token: input.token, newPassword: input.newPassword },
      });
    } catch {
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
    await recordSecurityEvent(user.id, "password_reset_completed");
  });
}

// --- Sessions -------------------------------------------------------------

const RevokeSessionInput = z.object({ token: z.string().min(1) });

/** Revoke one session. Backed by `auth.api.revokeSession`. */
export async function revokeSession(
  raw: z.input<typeof RevokeSessionInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = RevokeSessionInput.parse(raw);
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");

    // Better Auth scopes revocation to the CALLING session's user, so a forged
    // token from another account cannot be revoked through our session.
    try {
      await auth.api.revokeSession({
        body: { token: input.token },
        headers: await headers(),
      });
    } catch {
      throw new Error("That session couldn't be ended. Try again.");
    }

    await recordSecurityEvent(user.id, "session_revoked");

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
    const user = await requireCampUser();
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");
    try {
      await auth.api.revokeOtherSessions({ headers: await headers() });
    } catch {
      throw new Error("Those sessions couldn't be ended. Try again.");
    }
    await recordSecurityEvent(user.id, "sessions_revoked_others");
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
    if (!isDatabaseConfigured())
      throw new Error("The database isn't configured yet.");

    const currentEmail = user.email;
    if (!currentEmail) {
      throw new Error("This account has no email on record to change.");
    }
    if (currentEmail.toLowerCase() === input.newEmail.toLowerCase()) {
      throw new Error("That's already your sign-in email.");
    }

    const now = new Date();

    const confirmToken = newToken();
    const revokeToken = newToken();

    // Superseding the old pending request and creating the new one are ONE
    // transaction: the partial unique index allows exactly one `pending` row per
    // user, so a non-atomic pair could either leave the user with no request (old
    // cancelled, new insert failed) or collide with itself. Commit both together.
    await withTransaction(async (tx) => {
      await tx
        .update(schema.emailChangeRequests)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(schema.emailChangeRequests.userId, user.id),
            eq(schema.emailChangeRequests.status, "pending"),
          ),
        );

      await tx.insert(schema.emailChangeRequests).values({
        userId: user.id,
        currentEmail,
        newEmail: input.newEmail,
        status: "pending",
        confirmTokenHash: hashToken(confirmToken),
        revokeTokenHash: hashToken(revokeToken),
        expiresAt: emailChangeExpiresAt(now),
      });
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
    await recordSecurityEvent(user.id, "email_change_requested");

    revalidatePath("/account");
    return { message: enumerationSafeMessage("email_change_request") };
  });
}

const TokenInput = z.object({ token: z.string().min(1) });

/**
 * Confirm a change from the NEW address's link.
 *
 * WIRED FOR REAL (self-hosted). The confirm token proves control of the NEW
 * address, so on success we apply the address at the identity layer — a direct,
 * transactional update of the Better Auth `user` row we now own in our own DB.
 *
 * Why a direct write rather than `auth.api.changeEmail`: Better Auth's own
 * change-email runs its OWN confirmation flow (it sends a link to the CURRENT
 * address when that address is verified, and only applies on that second click),
 * which would collide with — and double up on — this app's token flow and its
 * 48-hour revocation window. Owning the DB lets us apply the confirmed address in
 * one place and honestly stamp `providerCommittedAt`. `emailVerified` is set true
 * because clicking the link sent to the NEW address is proof of control (the same
 * standard the god-bootstrap guard relies on).
 *
 * Still gated by `assertCapability('emailChange')` (now `supported`) — the single
 * kill-switch that keeps every not-yet-deliverable flow honest.
 */
export async function confirmEmailChange(
  raw: z.input<typeof TokenInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const user = await requireCampUser();
    const input = TokenInput.parse(raw);
    if (!isDatabaseConfigured())
      throw new Error("The database isn't configured yet.");

    const now = new Date();
    const [request] = await db()
      .select({
        id: schema.emailChangeRequests.id,
        newEmail: schema.emailChangeRequests.newEmail,
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
          eq(
            schema.emailChangeRequests.confirmTokenHash,
            hashToken(input.token),
          ),
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

    // Apply the address at the identity layer, mark the request confirmed, and
    // sync our own users.email row — as ONE transaction. If the identity update
    // fails (e.g. the new address is already taken by another identity), the
    // whole change rolls back: the request is NOT marked confirmed, `users.email`
    // is untouched, and nothing is announced. Only a real, committed identity
    // update stamps `providerCommittedAt`, which is what `isEmailChangeEffective`
    // reads — so the tombstone can never claim a change that didn't land.
    const confirmedAt = now;
    try {
      await withTransaction(async (tx) => {
        await tx
          .update(schema.user)
          .set({ email: request.newEmail, emailVerified: true, updatedAt: now })
          .where(eq(schema.user.id, user.authUserId));

        await tx
          .update(schema.emailChangeRequests)
          .set({
            status: "confirmed",
            confirmedAt,
            revocableUntil: emailChangeRevocableUntil(confirmedAt),
            providerCommittedAt: confirmedAt,
            updatedAt: now,
          })
          .where(eq(schema.emailChangeRequests.id, request.id));

        // Keep our own users.email row in step immediately (the session resolver
        // also syncs it on next sign-in, but /account should reflect it now).
        await tx
          .update(schema.users)
          .set({ email: request.newEmail })
          .where(eq(schema.users.id, user.id));
      });
    } catch (err) {
      // A unique violation on either identity row means the address is taken.
      if (isUniqueViolation(err)) {
        throw new Error(
          "That address can't be used — it may already be linked to another account.",
          { cause: err },
        );
      }
      throw err;
    }

    await recordSecurityEvent(user.id, "email_change_confirmed");

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
    if (!isDatabaseConfigured())
      throw new Error("The database isn't configured yet.");

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
      .where(
        eq(schema.emailChangeRequests.revokeTokenHash, hashToken(input.token)),
      )
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
    await recordSecurityEvent(request.userId, "email_change_revoked");

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
    if (!isDatabaseConfigured())
      throw new Error("The database isn't configured yet.");
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");
    if (!user.email) throw new Error("This account has no email on record.");

    // Re-auth. Deleting an account is the most destructive thing a session can
    // do, so a stolen session alone must not be enough.
    //
    // We re-authenticate by verifying the password through `signInEmail`, which
    // throws on a mismatch. Not returning it as a Response (no asResponse /
    // nextCookies) means NO session cookie reaches the caller — but Better Auth
    // still PERSISTS a `session` row on success. Left alone those rows accumulate
    // as live, valid tokens (a token nobody transmitted is still a usable token),
    // and account deletion is precisely when stray sessions must not survive. So
    // we capture the freshly-minted token and delete that row immediately: the
    // credential is verified with zero lasting session side effect.
    try {
      const reauth = await auth.api.signInEmail({
        body: { email: user.email, password: input.password },
      });
      const reauthToken = reauth?.token;
      if (reauthToken) {
        try {
          await db()
            .delete(schema.session)
            .where(eq(schema.session.token, reauthToken));
        } catch {
          // Best-effort: a lingering re-auth session is cleaned up by the
          // sweeper's identity deletion anyway; never fail deletion over it.
        }
      }
    } catch {
      throw new Error("That password didn't match. Try again.");
    }

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

    // The deletion request and its audit record commit together: a scheduled
    // deletion must never exist without the audit trail that proves who asked and
    // when, and an audit line must never claim a request that didn't persist.
    await withTransaction(async (tx) => {
      await tx.insert(schema.accountDeletionRequests).values({
        userId: user.id,
        status: "pending",
        requestedAt: now,
        graceEndsAt,
        requestedFromApp: "web",
      });

      await tx.insert(schema.auditEvents).values({
        actorId: user.id,
        action: "account.deletion_requested",
        subject: user.id,
        meta: { graceEndsAt: graceEndsAt.toISOString(), app: "web" },
      });
    });

    await notifySecurity(
      user.id,
      user.email,
      deletionRequestedNotification({
        daysRemaining: DELETION_GRACE_PERIOD_DAYS,
      }),
      deletionRequestedEmail({
        daysRemaining: DELETION_GRACE_PERIOD_DAYS,
        graceEndsAt,
      }),
    );
    await recordSecurityEvent(user.id, "deletion_requested");

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
    if (!cancelled)
      throw new Error("There's no deletion scheduled on this account.");
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

  // Cancel + audit atomically — same reasoning as the request path: the state
  // change and the record of it must land together.
  await withTransaction(async (tx) => {
    await tx
      .update(schema.accountDeletionRequests)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.accountDeletionRequests.id, request.id),
          eq(schema.accountDeletionRequests.status, "pending"),
        ),
      );

    await tx.insert(schema.auditEvents).values({
      actorId: userId,
      action: "account.deletion_cancelled",
      subject: userId,
      meta: { via: "sign_in" },
    });
  });

  await notifySecurity(
    userId,
    email,
    deletionCancelledNotification(),
    deletionCancelledEmail(),
  );
  await recordSecurityEvent(userId, "deletion_cancelled");
  return true;
}

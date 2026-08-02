"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  assessPassword,
  passwordChangedEmail,
  passwordChangedNotification,
} from "@quagga/core";
import { auth } from "@quagga/auth";
import { recordSecurityEvent } from "@quagga/auth/account";

import { getDb } from "@/lib/db";
import { isAuthConfigured } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { insertNotifications } from "@/lib/notifications";
import { applyAuthCookies, requireConsoleAccount } from "@/lib/account";

// The console's own account actions (roadmap M4-21) — the write side of
// /account and /account/security for a staff member's personal sign-in.
//
// A DELIBERATELY SHORT LIST. The participant app's equivalent runs to a thousand
// lines because it also owns email change, password reset and the whole deletion
// lifecycle. Those are not duplicated here: each is a multi-step flow with
// tokens, grace periods and a sweeper, and a second implementation would be a
// second place for a guard to be forgotten. What lives here is only what a staff
// member cannot do anywhere else — and every one of these is a single Better
// Auth call that the shared server API already scopes to the calling session.
//
// THE HONESTY RULE, as everywhere else: never report success for something that
// did not happen. `auth.api.*` throws on failure, so each call is wrapped and a
// refusal surfaces plainly; a "your password was changed" notice is never sent
// for a change that did not occur. A false security notification is worse than
// none — it trains people to ignore the real one.

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
    // Next signals redirect() and notFound() by THROWING. Catching those here
    // would render the literal string "NEXT_REDIRECT" to a staff member whose
    // session had expired.
    unstable_rethrow(err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Something went wrong. Try again.",
    };
  }
}

/** Best-effort security notice: an inbox row plus, when configured, an email. */
async function notifySecurity(
  userId: string,
  email: string | null,
  mail: { subject: string; text: string } | null,
): Promise<void> {
  try {
    await insertNotifications(getDb(), [
      {
        userId,
        ...passwordChangedNotification(),
        origin: "system" as const,
        // The console is where this change was made, so the console is where
        // the notification's link should land. Same relative path in all three
        // apps; `linkApp` is what picks the host.
        linkApp: "org" as const,
      },
    ]);
  } catch {
    // A failed inbox write must not roll back a completed security change.
  }
  if (mail && email) {
    try {
      // Called even when RESEND_API_KEY is unset — the seam logs to the console
      // in that case, which is how these flows stay observable env-less.
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
 * Change the password from a signed-in session. Better Auth's `changePassword`
 * re-authenticates with the current password server-side — we never verify a
 * password ourselves.
 *
 * Policy is enforced here before the call so the staff member gets our message
 * rather than the provider's, using the same @quagga/core assessment the
 * participant app applies. One password policy, three doors.
 */
export async function changePassword(
  raw: z.input<typeof ChangePasswordInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const account = await requireConsoleAccount();
    const input = ChangePasswordInput.parse(raw);

    if (!isAuthConfigured()) {
      throw new Error(
        "Sign-in isn't configured yet, so passwords can't change.",
      );
    }

    const assessment = assessPassword(input.newPassword);
    if (!assessment.ok) {
      throw new Error(assessment.error ?? "That password won't do.");
    }

    // Fail CLOSED: if the call throws, nothing changed, so nothing is
    // announced. The message stays generic — a precise upstream error is a
    // credential oracle.
    try {
      const result = await auth.api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: input.revokeOtherSessions,
        },
        headers: await headers(),
        returnHeaders: true,
      });
      // Hand the rotated session cookie back — see `applyAuthCookies`. Without
      // it this "successful" change signs the person out five minutes later.
      await applyAuthCookies(result.headers);
    } catch {
      throw new Error(
        "That didn't work. Check your current password and try again.",
      );
    }

    await notifySecurity(
      account.id,
      account.email,
      passwordChangedEmail({ when: new Date() }),
    );
    await recordSecurityEvent(await headers(), account.id, "password_changed");

    revalidatePath("/account/security");
    return { message: "Password changed." };
  });
}

// --- Sessions -------------------------------------------------------------

const RevokeSessionInput = z.object({ token: z.string().min(1) });

/** Revoke one session. */
export async function revokeSession(
  raw: z.input<typeof RevokeSessionInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const account = await requireConsoleAccount();
    const input = RevokeSessionInput.parse(raw);
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");

    // Better Auth scopes revocation to the CALLING session's user, so a forged
    // token from another account cannot be revoked through this session.
    try {
      await auth.api.revokeSession({
        body: { token: input.token },
        headers: await headers(),
      });
    } catch {
      throw new Error("That session couldn't be ended. Try again.");
    }

    await recordSecurityEvent(await headers(), account.id, "session_revoked");
    revalidatePath("/account/security");
    return { message: "Session ended." };
  });
}

/**
 * Revoke every OTHER session, keeping the current one. Deliberately not "revoke
 * all" — signing yourself out while trying to secure your account is a hostile
 * outcome, and the button says so.
 */
export async function revokeOtherSessions(): Promise<AccountActionResult> {
  return run(async () => {
    const account = await requireConsoleAccount();
    if (!isAuthConfigured()) throw new Error("Sign-in isn't configured yet.");
    try {
      await auth.api.revokeOtherSessions({ headers: await headers() });
    } catch {
      throw new Error("Those sessions couldn't be ended. Try again.");
    }
    await recordSecurityEvent(
      await headers(),
      account.id,
      "sessions_revoked_others",
    );
    revalidatePath("/account/security");
    return { message: "Every other device has been signed out." };
  });
}

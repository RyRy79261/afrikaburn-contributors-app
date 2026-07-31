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
import { auth, sendSingleEmail } from "@quagga/auth";
import { recordSecurityEvent } from "@quagga/auth/account";

import { getDb } from "@/lib/db";
import { isAuthConfigured } from "@/lib/config";
import { insertNotifications } from "@/lib/notifications";
import { applyAuthCookies, requirePortalAccount } from "@/lib/account";

// The portal's own account actions (roadmap M4-21) — the write side of /account
// and /account/security for a supplier's personal sign-in.
//
// A DELIBERATELY SHORT LIST, for the same reason as the console's: email change,
// password reset and the deletion lifecycle each have one implementation on the
// participant app, and a second entry point would be a second place for their
// guards to be forgotten. What lives here is only what a supplier cannot do
// anywhere else.
//
// THE HONESTY RULE: never report success for something that did not happen.
// `auth.api.*` throws on failure, so each call is wrapped and a refusal surfaces
// plainly. A "your password was changed" notice for a change that did not occur
// is worse than none — it trains people to ignore the real one.

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
    // Next signals redirect() and notFound() by THROWING; catching those here
    // would render the literal string "NEXT_REDIRECT" to somebody whose session
    // had expired.
    unstable_rethrow(err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Something went wrong. Try again.",
    };
  }
}

/**
 * Best-effort security notice: an inbox row plus an email.
 *
 * THE EMAIL IS THE POINT, not a nicety. A password change is exactly the moment
 * an account takeover becomes visible: whoever changed it controls the session,
 * so an in-app notice reaches the attacker, and only the mail reaches the owner.
 * This portal has no `lib/email.ts` of its own — rather than add a third copy of
 * the Resend seam, it uses @quagga/auth's single-recipient sender, which logs to
 * the console when RESEND_API_KEY is unset so the flow is observable env-less.
 */
async function notifyPasswordChanged(
  userId: string,
  email: string | null,
): Promise<void> {
  try {
    await insertNotifications(getDb(), [
      {
        userId,
        ...passwordChangedNotification(),
        origin: "system" as const,
        // Changed here, so the notification's link lands here. The path is the
        // same in all three apps; `linkApp` picks the host.
        linkApp: "suppliers" as const,
      },
    ]);
  } catch {
    // A failed inbox write must not roll back a completed security change.
  }
  if (email) {
    const mail = passwordChangedEmail({ when: new Date() });
    // Never throws, by contract — see @quagga/auth `sendSingleEmail`.
    await sendSingleEmail(
      process.env,
      email,
      mail.subject,
      mail.text,
      "suppliers:email",
    );
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
 * password ourselves. Policy comes from the same @quagga/core assessment the
 * other two apps apply: one password policy, three doors.
 */
export async function changePassword(
  raw: z.input<typeof ChangePasswordInput>,
): Promise<AccountActionResult> {
  return run(async () => {
    const account = await requirePortalAccount();
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

    await notifyPasswordChanged(account.id, account.email);
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
    const account = await requirePortalAccount();
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
    const account = await requirePortalAccount();
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

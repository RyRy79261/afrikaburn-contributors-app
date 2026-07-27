"use server";

import { z } from "zod";
import { assessPassword, enumerationSafeMessage } from "@quagga/core";
import { auth } from "@quagga/auth";
import { isAuthConfigured } from "@/lib/config";

// Self-hosted password recovery for the supplier portal. Thin wrappers over
// @quagga/auth's server API (auth.api.requestPasswordReset / resetPassword),
// enumeration-safe and honestly-unavailable without an email sender — the same
// posture as apps/web's account-actions.

export type PasswordActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

const RequestInput = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().trim().max(512).optional(),
});

export async function requestPasswordReset(
  raw: z.input<typeof RequestInput>,
): Promise<PasswordActionResult> {
  const input = RequestInput.parse(raw);
  if (!isAuthConfigured() || !process.env.RESEND_API_KEY) {
    return {
      ok: false,
      error:
        "Password reset by email isn't available yet — no reset link can be sent. Contact AfrikaBurn for help.",
    };
  }
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
  return { ok: true, message: enumerationSafeMessage("forgot_password") };
}

const ResetInput = z.object({
  token: z.string().min(1),
  newPassword: z.string(),
});

export async function resetPassword(
  raw: z.input<typeof ResetInput>,
): Promise<PasswordActionResult> {
  const input = ResetInput.parse(raw);
  if (!isAuthConfigured())
    return { ok: false, error: "Sign-in isn't configured yet." };

  const assessment = assessPassword(input.newPassword);
  if (!assessment.ok) {
    return { ok: false, error: assessment.error ?? "That password won't do." };
  }

  try {
    await auth.api.resetPassword({
      body: { token: input.token, newPassword: input.newPassword },
    });
  } catch {
    return {
      ok: false,
      error:
        "That reset link has expired or has already been used. Request a new one.",
    };
  }
  return {
    ok: true,
    message: "Password reset. Sign in with your new password.",
  };
}

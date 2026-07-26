// The auth email seam. Better Auth's hooks (sendResetPassword,
// sendVerificationEmail, sendChangeEmailVerification, onPasswordReset) call
// through here. It mirrors each app's lib/email.ts Resend seam so the shared
// config stays SELF-CONTAINED and identical across all three apps (identical
// config is what SSO needs): it delivers via Resend when RESEND_API_KEY is set
// and otherwise LOGS to the console, so auth flows are observable env-less and
// the apps still boot without an email provider.
//
// Copy that carries NO token (the "your password was reset" notice) reuses the
// @quagga/core security-notification builders — one source of truth for security
// wording. The token/link envelopes (reset link, verification link, change-email
// confirmation) are assembled here because they carry runtime data (a URL) that a
// pure-domain builder must not; the change-email confirmation reuses core's
// emailChangeConfirmEmail, which already takes a URL.

import {
  emailChangeConfirmEmail,
  passwordResetCompletedEmail,
} from "@quagga/core";
import type { AuthEnv } from "./env";
import { isEmailProviderConfigured } from "./env";

/** A plain email envelope. Deliberately NOT @quagga/core's SecurityEmail — its
 * `kind` (SecurityEventKind) has no member for a reset-REQUEST or a verification
 * link, and forcing a "…_completed" label onto a request email would be
 * dishonest metadata. Core builders that DO carry a kind are consumed for their
 * {subject,text} only. */
interface AuthEmailBody {
  subject: string;
  text: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM =
  "AfrikaBurn Contributors <no-reply@contributors.afrikaburn.com>";

/** Reset/verification token lifetime in the copy — matches the Better Auth
 * option defaults (resetPasswordTokenExpiresIn / verification expiresIn = 1h). */
const TOKEN_EXPIRY_HOURS = 1;

export type AuthEmailKind =
  | "reset"
  | "verify"
  | "change-email"
  | "password-reset-completed";

export interface AuthEmailInput {
  to: string;
  kind: AuthEmailKind;
  /** Required for "reset" | "verify" | "change-email"; ignored otherwise. */
  url?: string | undefined;
}

const SIGN_OFF = "\n\n— AfrikaBurn Contributors";

/** Build the {subject,text} envelope for an auth email. */
function buildAuthEmail(input: AuthEmailInput): AuthEmailBody {
  switch (input.kind) {
    case "reset":
      return {
        subject: "Reset your AfrikaBurn password",
        text:
          "Someone (hopefully you) asked to reset the password for this " +
          "AfrikaBurn Contributors account.\n\n" +
          `Reset it here (the link works once and expires in ${TOKEN_EXPIRY_HOURS} ` +
          `hour):\n${input.url ?? ""}\n\n` +
          "If you didn't ask for this, ignore this email — your password stays " +
          "the same." +
          SIGN_OFF,
      };
    case "verify":
      return {
        subject: "Confirm your AfrikaBurn email",
        text:
          "Confirm this email address to finish setting up your AfrikaBurn " +
          "Contributors account.\n\n" +
          `Confirm here (expires in ${TOKEN_EXPIRY_HOURS} hour):\n${input.url ?? ""}\n\n` +
          "If this wasn't you, ignore this email." +
          SIGN_OFF,
      };
    case "change-email":
      return emailChangeConfirmEmail({
        confirmUrl: input.url ?? "",
        expiresInHours: TOKEN_EXPIRY_HOURS,
      });
    case "password-reset-completed":
      return passwordResetCompletedEmail({ when: new Date() });
  }
}

/**
 * Send an auth email. Never throws: a Better Auth hook that throws would fail the
 * whole auth request, so a delivery failure is logged and swallowed. Returns
 * whether it was actually delivered (false = console-logged, provider unset).
 */
export async function sendAuthEmail(
  env: AuthEnv,
  input: AuthEmailInput,
): Promise<boolean> {
  const { subject, text } = buildAuthEmail(input);

  if (!isEmailProviderConfigured(env)) {
    console.info(
      `[auth:email:console] (RESEND_API_KEY unset) → ${input.to}\n` +
        `  subject: ${subject}\n  ${text.replace(/\n/g, "\n  ")}`,
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: [input.to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      console.error(`[auth:email] Resend responded ${res.status}: ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[auth:email] send failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

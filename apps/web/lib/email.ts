import "server-only";

// Resend integration (build-spec §Stack; mvp-proposal: "Resend from day one").
// The MVP sends via Resend's HTTP API when RESEND_API_KEY is set, and otherwise
// LOGS the message to the console — so auth/notification flows are observable in
// development and the app boots and runs env-lessly.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM =
  "AfrikaBurn Contributors <no-reply@contributors.afrikaburn.com>";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  /** Plain-text body. HTML is derived from it when `html` is omitted. */
  text: string;
  html?: string;
  from?: string;
}

export type SendEmailResult =
  | { ok: true; id: string | null; delivered: boolean }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send an email. Delivers via Resend when configured; otherwise logs to the
 * console and returns `delivered: false` so callers can surface "email not
 * configured" honestly without failing the request.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const from = input.from ?? DEFAULT_FROM;

  if (!isEmailConfigured()) {
    console.info(
      `[email:console] (RESEND_API_KEY unset) → ${to.join(", ")}\n` +
        `  subject: ${input.subject}\n` +
        `  ${input.text.replace(/\n/g, "\n  ")}`,
    );
    return { ok: true, id: null, delivered: false };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<pre>${escapeHtml(input.text)}</pre>`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      return { ok: false, error: `Resend responded ${res.status}: ${detail}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? null, delivered: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email send failed",
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

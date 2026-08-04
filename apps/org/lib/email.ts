import "server-only";

// Resend integration (build-spec §Stack — Resend from day one).
//
// BYTE-IDENTICAL TWIN of apps/web/lib/email.ts. Keep them in lockstep — the
// multi-recipient disclosure fixed here existed in both copies at once, which is
// the argument for a shared package the next time this file is touched.
// The MVP sends via Resend's HTTP API when RESEND_API_KEY is set, and otherwise
// LOGS the message to the console — so auth/notification flows are observable in
// development and the app boots and runs env-lessly.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_BATCH_ENDPOINT = "https://api.resend.com/emails/batch";
/** Resend's documented ceiling for one batch call. */
const RESEND_BATCH_MAX = 100;
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
 *
 * ONE RECIPIENT PER MESSAGE, ALWAYS. A `to` array used to be handed to Resend
 * verbatim, which puts every address in the `To:` header — so a camp-roster
 * questionnaire send disclosed every member's email address to every other
 * member. That is a POPIA disclosure, not a formatting detail. Multi-recipient
 * sends now fan out through Resend's batch endpoint as N separate messages
 * (chunked at its documented 100-per-call ceiling), so no recipient ever learns
 * who else was mailed. There is deliberately no bcc path: bcc would still put
 * all of them in one message, one misconfigured header away from the same leak.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
  const from = input.from ?? DEFAULT_FROM;

  if (recipients.length === 0) {
    return { ok: false, error: "No recipients." };
  }

  if (!isEmailConfigured()) {
    console.info(
      `[email:console] (RESEND_API_KEY unset) → ${recipients.length} recipient(s)\n` +
        `  subject: ${input.subject}\n` +
        `  ${input.text.replace(/\n/g, "\n  ")}`,
    );
    return { ok: true, id: null, delivered: false };
  }

  const html = input.html ?? `<pre>${escapeHtml(input.text)}</pre>`;
  const message = (to: string) => ({
    from,
    to: [to],
    subject: input.subject,
    text: input.text,
    html,
  });

  try {
    if (recipients.length === 1) {
      return await post(RESEND_ENDPOINT, message(recipients[0]!));
    }

    // Fan out in batches. A failed chunk fails the whole send rather than
    // reporting a partial success as `ok` — the caller decides how to react.
    let firstId: string | null = null;
    for (let i = 0; i < recipients.length; i += RESEND_BATCH_MAX) {
      const chunk = recipients.slice(i, i + RESEND_BATCH_MAX);
      const result = await post(
        RESEND_BATCH_ENDPOINT,
        chunk.map((to) => message(to)),
      );
      if (!result.ok) return result;
      firstId ??= result.id;
    }
    return { ok: true, id: firstId, delivered: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email send failed",
    };
  }
}

/** One Resend HTTP call. Shared by the single and batch paths. */
async function post(
  endpoint: string,
  body: unknown,
): Promise<SendEmailResult> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return { ok: false, error: `Resend responded ${res.status}: ${detail}` };
  }
  const parsed = (await res.json().catch(() => ({}))) as {
    id?: string;
    data?: { id?: string }[];
  };
  const id = parsed.id ?? parsed.data?.[0]?.id ?? null;
  return { ok: true, id, delivered: true };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

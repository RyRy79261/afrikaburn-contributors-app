// e2e/lib/mail.ts — mail capture for verification / reset / notification links.
//
// STRATEGY (roadmap M3-17, decided): a disposable-inbox API (mail.tm) is the
// primary capture. Why this and not the alternatives:
//   - It exercises the REAL delivery path (app → Resend → DNS → inbox), which is
//     the whole point of an E2E; a token-peek endpoint would not.
//   - It needs NO product-code change and ships NO auth side-door. (If the
//     token-peek fallback (option c) is ever added because third-party flakiness
//     makes the nightly unreliable, it MUST be secret-gated and MUST hard-refuse
//     when the secret is unset, with a route-census entry and a test asserting
//     the refusal — see e2e/README.md "Mail capture". We deliberately do not
//     ship it here.)
//
// SKIP-AWARE: email verification is currently OFF on the deployment (no
// RESEND_API_KEY), so mail is UNavailable by default. Flows that need a link
// call `requireMailbox()`, which throws a MailUnavailableError; specs translate
// that into `test.skip()` via `skipUnlessMail()`. The moment a Resend key exists
// and E2E_MAIL_MODE=mailtm is set, the same specs light up unchanged.

import { isMailCaptureAvailable, TIMEOUTS } from "./env";

const MAILTM_API = process.env.E2E_MAILTM_API ?? "https://api.mail.tm";

/** Thrown when a link is needed but no mail provider/capture is configured. */
export class MailUnavailableError extends Error {
  constructor() {
    super(
      "Mail capture is not available (E2E_MAIL_MODE=off / no RESEND on the " +
        "deployment). This flow needs a real email link; skip it.",
    );
    this.name = "MailUnavailableError";
  }
}

/** A live disposable inbox: an address the app can send to, plus reader creds. */
export interface Mailbox {
  address: string;
  password: string;
  /** Bearer token for the mail.tm API. */
  token: string;
  /** Poll for the newest message whose subject/body matches, and return its text+html. */
  waitForMessage(match?: MessageMatcher): Promise<CapturedMessage>;
  /** Convenience: wait for a message and return the first URL matching `pattern`. */
  waitForLink(pattern: RegExp, match?: MessageMatcher): Promise<string>;
}

export interface CapturedMessage {
  id: string;
  subject: string;
  from: string;
  text: string;
  html: string;
  /** All hrefs/URLs found across text + html. */
  links: string[];
}

/** Optional filter so a mailbox reused across steps picks the RIGHT message. */
export type MessageMatcher = (m: { subject: string; from: string }) => boolean;

interface MailtmDomain {
  domain: string;
  isActive: boolean;
}

async function api<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${MAILTM_API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[e2e:mail] ${init?.method ?? "GET"} ${path} → ${res.status} ${body}`,
    );
  }
  return (await res.json()) as T;
}

async function activeDomain(): Promise<string> {
  const data = await api<{ "hydra:member": MailtmDomain[] }>("/domains");
  const active = data["hydra:member"].find((d) => d.isActive);
  if (!active)
    throw new Error("[e2e:mail] mail.tm has no active domain right now");
  return active.domain;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

function extractLinks(text: string, html: string): string[] {
  const found = new Set<string>();
  for (const src of [text, html]) {
    for (const m of src.matchAll(URL_RE)) {
      // Strip a trailing '&amp;'-decoded artefact and common trailing punctuation.
      found.add(m[0].replace(/&amp;/g, "&").replace(/[.,;]+$/, ""));
    }
  }
  return [...found];
}

/**
 * Provision a fresh disposable inbox. Throws MailUnavailableError when capture
 * is off — callers should prefer `requireMailbox()`, which is the same but names
 * the intent at the call site.
 */
export async function createMailbox(localHint = "burner"): Promise<Mailbox> {
  if (!isMailCaptureAvailable()) throw new MailUnavailableError();

  const domain = await activeDomain();
  const slug =
    localHint
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "burner";
  const address = `${slug}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}@${domain}`;
  const password = "e2e-mailbox-correct-horse-staple";

  await api("/accounts", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  const { token } = await api<{ token: string }>("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  async function waitForMessage(
    match?: MessageMatcher,
  ): Promise<CapturedMessage> {
    const deadline = Date.now() + TIMEOUTS.mail;
    let lastCount = 0;
    while (Date.now() < deadline) {
      const list = await api<{
        "hydra:member": Array<{
          id: string;
          subject: string;
          from: { address: string };
        }>;
      }>("/messages", { token });
      const members = list["hydra:member"];
      lastCount = members.length;
      for (const meta of members) {
        const from = meta.from?.address ?? "";
        if (match && !match({ subject: meta.subject ?? "", from })) continue;
        const full = await api<{
          id: string;
          subject: string;
          from: { address: string };
          text?: string;
          html?: string[];
        }>(`/messages/${meta.id}`, { token });
        const text = full.text ?? "";
        const html = (full.html ?? []).join("\n");
        return {
          id: full.id,
          subject: full.subject ?? "",
          from: full.from?.address ?? "",
          text,
          html,
          links: extractLinks(text, html),
        };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(
      `[e2e:mail] Timed out after ${TIMEOUTS.mail}ms waiting for a message to ` +
        `${address} (saw ${lastCount} message(s), none matched).`,
    );
  }

  async function waitForLink(
    pattern: RegExp,
    match?: MessageMatcher,
  ): Promise<string> {
    const msg = await waitForMessage(match);
    const link = msg.links.find((l) => pattern.test(l));
    if (!link) {
      throw new Error(
        `[e2e:mail] Message "${msg.subject}" had no link matching ${pattern}. ` +
          `Links: ${msg.links.join(", ") || "(none)"}`,
      );
    }
    return link;
  }

  return { address, password, token, waitForMessage, waitForLink };
}

/** Name-at-call-site alias for createMailbox — use in flows that read a link. */
export async function requireMailbox(localHint = "burner"): Promise<Mailbox> {
  return createMailbox(localHint);
}

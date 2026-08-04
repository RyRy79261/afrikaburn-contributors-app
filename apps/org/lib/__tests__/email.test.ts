import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// THE B2 REGRESSION PIN (audit, 27 Jul 2026).
//
// `sendEmail` handed a `to` ARRAY straight to Resend, which puts every address
// in the To: header. A camp-roster questionnaire send therefore disclosed every
// member's email address to every other member — a POPIA disclosure, produced
// by ordinary use of the feature. It was latent only because RESEND_API_KEY was
// unset; setting it (which docs/deploy.md instructs) armed it.
//
// These tests execute the real module against a stubbed fetch and assert the
// property that matters: NO REQUEST EVER CARRIES MORE THAN ONE RECIPIENT.
//
// PORTED, NOT INVENTED. `apps/org/lib/email.ts` declares itself a byte-identical
// twin of `apps/web/lib/email.ts` (the two differ by four comment lines), and
// the disclosure above existed in BOTH copies at once and was fixed in both.
// This file is `apps/web/lib/__tests__/email.test.ts` with the org-specific
// cases added at the end, so the twin cannot drift back on this side alone.

type Captured = { url: string; body: unknown };

let captured: Captured[] = [];

beforeEach(() => {
  captured = [];
  process.env.RESEND_API_KEY = "re_test_key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      captured.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({ id: "msg_1" }),
        text: async () => "",
        status: 200,
        statusText: "OK",
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

/** Every `to` field across every captured request, flattened. */
function recipientsPerMessage(): string[][] {
  return captured.flatMap((c) => {
    const body = c.body as
      | { to: string[] }
      | { to: string[] }[];
    return Array.isArray(body) ? body.map((m) => m.to) : [body.to];
  });
}

describe("sendEmail never discloses one recipient to another", () => {
  it("puts exactly one address in every message, for any list size", async () => {
    const { sendEmail } = await import("../email");
    const roster = Array.from({ length: 7 }, (_, i) => `burner${i}@example.com`);

    const result = await sendEmail({
      to: roster,
      subject: "Please complete: Camp questionnaire",
      text: "body",
    });

    expect(result.ok).toBe(true);
    const perMessage = recipientsPerMessage();
    expect(perMessage).toHaveLength(roster.length);
    for (const to of perMessage) expect(to).toHaveLength(1);
    // Every intended recipient still got exactly one message.
    expect(perMessage.flat().sort()).toEqual([...roster].sort());
  });

  it("no single MESSAGE mentions two different recipients", async () => {
    // The property stated negatively, against each serialised message object.
    //
    // Note the granularity: a batch call is ONE http request carrying N
    // independent messages, so the request body legitimately names everyone.
    // What must never happen is two addresses inside one message — that is what
    // produces a shared To: header, and it is what a reintroduced `to: [a, b]`
    // or a cc/bcc shortcut would look like here.
    const { sendEmail } = await import("../email");
    await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });

    for (const call of captured) {
      const body = call.body as Record<string, unknown>[] | Record<string, unknown>;
      const messages = Array.isArray(body) ? body : [body];
      for (const message of messages) {
        const serialised = JSON.stringify(message);
        const mentionsA = serialised.includes("a@example.com");
        const mentionsB = serialised.includes("b@example.com");
        expect(mentionsA && mentionsB).toBe(false);
      }
    }
  });

  it("uses the batch endpoint for many and the single endpoint for one", async () => {
    const { sendEmail } = await import("../email");

    await sendEmail({ to: "solo@example.com", subject: "s", text: "t" });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.resend.com/emails");

    captured = [];
    await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.resend.com/emails/batch");
    expect(Array.isArray(captured[0]!.body)).toBe(true);
  });

  it("chunks a list larger than one batch rather than truncating it", async () => {
    const { sendEmail } = await import("../email");
    const many = Array.from({ length: 250 }, (_, i) => `b${i}@example.com`);

    const result = await sendEmail({ to: many, subject: "s", text: "t" });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(3); // 100 + 100 + 50
    expect(recipientsPerMessage().flat()).toHaveLength(250);
  });

  it("drops blanks and refuses a send with no real recipient", async () => {
    const { sendEmail } = await import("../email");
    const result = await sendEmail({ to: ["  ", ""], subject: "s", text: "t" });
    expect(result.ok).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it("reports a provider failure instead of claiming delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        statusText: "Unprocessable",
        text: async () => "bad domain",
        json: async () => ({}),
      })),
    );
    const { sendEmail } = await import("../email");
    const result = await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });
    expect(result.ok).toBe(false);
  });

  it("logs instead of sending when no API key is configured", async () => {
    delete process.env.RESEND_API_KEY;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { sendEmail } = await import("../email");

    const result = await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });

    expect(result).toMatchObject({ ok: true, delivered: false });
    expect(captured).toHaveLength(0);
    // The console fallback must not print the roster either — it used to join
    // every address into one line.
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("a@example.com");
    info.mockRestore();
  });
});

/**
 * The rest of the module's contract, beyond the disclosure property: the
 * env-less path, the two response shapes and the failure modes. All of it
 * matters because every console notification hook calls this and treats a
 * `false` as "email is not configured" rather than "the send failed".
 */
describe("sendEmail — the rest of the contract", () => {
  it("reads the id from the single-message response shape", async () => {
    const { sendEmail } = await import("../email");
    const result = await sendEmail({ to: "a@example.com", subject: "s", text: "t" });
    expect(result).toEqual({ ok: true, id: "msg_1", delivered: true });
  });

  it("reads the id from the BATCH response shape", async () => {
    // Resend answers a batch call with `{ data: [{ id }, …] }`, not `{ id }`.
    // Reading only the first shape reported every fan-out as unidentified.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        captured.push({ url, body: JSON.parse(init.body) });
        return {
          ok: true,
          json: async () => ({ data: [{ id: "batch_1" }, { id: "batch_2" }] }),
          text: async () => "",
          status: 200,
          statusText: "OK",
        };
      }),
    );
    const { sendEmail } = await import("../email");
    const result = await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });
    expect(result).toMatchObject({ ok: true, id: "batch_1", delivered: true });
  });

  it("reports a thrown fetch rather than letting it escape the caller", async () => {
    // A DNS failure or an aborted request must arrive as `{ ok: false }`. An
    // escaping throw inside a notification hook would roll back the decision
    // the hook was only ever meant to announce.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.resend.com");
      }),
    );
    const { sendEmail } = await import("../email");
    const result = await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      text: "t",
    });
    expect(result).toEqual({
      ok: false,
      error: "getaddrinfo ENOTFOUND api.resend.com",
    });
  });

  it("derives escaped HTML from the text, and honours an explicit body", async () => {
    // The plain-text body is authored by staff (a rejection reason, a bulletin)
    // and lands inside an HTML document; unescaped, a camp name with an angle
    // bracket in it breaks the message or worse.
    const { sendEmail } = await import("../email");
    await sendEmail({
      to: "a@example.com",
      subject: "s",
      text: "5 < 6 & <script>alert(1)</script>",
    });
    const body = captured[0]!.body as { html: string };
    expect(body.html).toBe(
      "<pre>5 &lt; 6 &amp; &lt;script&gt;alert(1)&lt;/script&gt;</pre>",
    );

    captured = [];
    await sendEmail({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>hand written</p>",
    });
    expect((captured[0]!.body as { html: string }).html).toBe(
      "<p>hand written</p>",
    );
  });

  it("names the failure honestly when the provider refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        statusText: "Unprocessable",
        text: async () => "domain not verified",
        json: async () => ({}),
      })),
    );
    const { sendEmail } = await import("../email");
    const result = await sendEmail({ to: "a@example.com", subject: "s", text: "t" });
    expect(result).toEqual({
      ok: false,
      error: "Resend responded 422: domain not verified",
    });
  });

  it("refuses an entirely empty list with a stated reason and no fetch", async () => {
    const { sendEmail } = await import("../email");
    await expect(
      sendEmail({ to: [], subject: "s", text: "t" }),
    ).resolves.toEqual({ ok: false, error: "No recipients." });
    expect(captured).toHaveLength(0);
  });

  it("knows whether email is configured at all", async () => {
    const { isEmailConfigured } = await import("../email");
    expect(isEmailConfigured()).toBe(true);
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });
});

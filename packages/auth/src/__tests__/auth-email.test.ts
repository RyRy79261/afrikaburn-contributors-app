import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sendAuthEmail, sendSingleEmail, type AuthEmailKind } from "../email";

// THE AUTH EMAIL SEAM — the only path by which a burner recovers a password,
// and not one line of it executed in CI.
//
// Two properties matter more than the copy does:
//
//   1. IT MUST NEVER THROW. Every caller is a Better Auth hook, and a hook that
//      throws fails the whole auth request — so a Resend outage would stop
//      password RESETS from being requested at all, rather than merely stop the
//      email arriving.
//   2. ONE RECIPIENT PER MESSAGE, BY TYPE. `to` is a string here, deliberately,
//      unlike the apps' roster-mailing seam. An array is one careless call away
//      from putting a second address in a To: header — the POPIA disclosure the
//      apps' multi-recipient path was rewritten to prevent (B2).
//
// The copy itself is deliberately NOT pinned. Asserting the prose would make an
// ordinary wording change look like a security regression, and that trains
// people to edit tests until they pass. What is asserted are the invariants: a
// non-empty subject, exactly one recipient, a link in the three kinds that
// carry a token and NO link in the two that are notices.

type Captured = {
  url: string;
  authorization: string | undefined;
  body: { from: string; to: string[]; subject: string; text: string };
};

let captured: Captured[] = [];
let response: {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
};
let fetchError: Error | string | null = null;

const KEYED = { RESEND_API_KEY: "re_test_key" };

beforeEach(() => {
  captured = [];
  fetchError = null;
  response = {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init: { body: string; headers: Record<string, string> },
      ) => {
        if (fetchError) throw fetchError;
        captured.push({
          url,
          authorization: init.headers.Authorization,
          body: JSON.parse(init.body),
        });
        return response;
      },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Everything console.info / console.error was handed, joined. */
function logged(spy: "info" | "error"): string {
  return vi.mocked(console[spy]).mock.calls.flat().join("\n");
}

const ALL_KINDS: AuthEmailKind[] = [
  "reset",
  "verify",
  "change-email",
  "password-reset-completed",
  "deletion-cancelled",
];

// --- Env-less: log, and say honestly that nothing was delivered ------------

describe("with no email provider configured", () => {
  it("returns false and logs the recipient, the subject and the link", async () => {
    // false means NOT DELIVERED. Returning true because "we handled it" would
    // let a sign-up flow tell someone to check an inbox nothing was sent to.
    const delivered = await sendAuthEmail(
      {},
      {
        to: "alice@example.com",
        kind: "reset",
        url: "https://app.test/reset?token=abc",
      },
    );

    expect(delivered).toBe(false);
    const line = logged("info");
    expect(line).toContain("alice@example.com");
    expect(line).toContain("RESEND_API_KEY unset");
    // The link is the whole point of the console fallback: env-less local auth
    // flows are only completable because the token comes out in the log.
    expect(line).toContain("https://app.test/reset?token=abc");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("uses a caller's log prefix, and auth:email when none is given", async () => {
    await sendSingleEmail(
      {},
      "alice@example.com",
      "Subject",
      "Body",
      "web:email",
    );
    expect(logged("info")).toContain("[web:email:console]");

    await sendSingleEmail({}, "alice@example.com", "Subject", "Body");
    expect(logged("info")).toContain("[auth:email:console]");
  });
});

// --- The envelopes --------------------------------------------------------

describe("every kind of auth email", () => {
  it("addresses exactly one recipient and carries a non-empty subject", async () => {
    for (const kind of ALL_KINDS) {
      await sendAuthEmail(KEYED, {
        to: "alice@example.com",
        kind,
        url: "https://app.test/go?token=abc",
      });
    }

    expect(captured).toHaveLength(ALL_KINDS.length);
    for (const c of captured) {
      expect(c.body.to).toEqual(["alice@example.com"]);
      expect(c.body.subject.length).toBeGreaterThan(0);
      expect(c.body.text.length).toBeGreaterThan(0);
    }
  });

  it("puts the link in the three token kinds and in neither notice", async () => {
    const url = "https://app.test/go?token=abc";
    for (const kind of ALL_KINDS) {
      await sendAuthEmail(KEYED, { to: "alice@example.com", kind, url });
    }

    const carriesUrl = captured.map((c) => c.body.text.includes(url));
    expect(carriesUrl).toEqual([true, true, true, false, false]);
    // Stated the strong way for the two notices: no link of ANY kind. A
    // "your password was reset" notice that grows a clickable URL is a
    // phishing template with our name on it.
    for (const c of captured.slice(3)) {
      expect(c.body.text).not.toMatch(/https?:\/\//);
    }
  });

  it("degrades a missing url to an empty string rather than the word undefined", async () => {
    // A hook that forgets the url must not mail out "…reset it here:
    // undefined". Silence is recoverable; a broken link is a support ticket.
    for (const kind of ["reset", "verify", "change-email"] as AuthEmailKind[]) {
      await sendAuthEmail(KEYED, { to: "alice@example.com", kind });
    }

    for (const c of captured) {
      expect(c.body.text).not.toContain("undefined");
    }
  });
});

// --- The provider call ----------------------------------------------------

describe("delivery via Resend", () => {
  it("posts to the Resend endpoint with a bearer token and reports success", async () => {
    const delivered = await sendAuthEmail(KEYED, {
      to: "alice@example.com",
      kind: "verify",
      url: "https://app.test/verify?token=abc",
    });

    expect(delivered).toBe(true);
    expect(captured[0]?.url).toBe("https://api.resend.com/emails");
    expect(captured[0]?.authorization).toBe("Bearer re_test_key");
    expect(captured[0]?.body.from).toContain("@");
  });

  it("returns false and logs the status AND the body when Resend refuses", async () => {
    // The status alone is not debuggable — Resend's 422s say which field is
    // wrong only in the body.
    response = {
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: async () => '{"message":"Invalid `to` field"}',
    };

    const delivered = await sendAuthEmail(KEYED, {
      to: "not-an-email",
      kind: "deletion-cancelled",
    });

    expect(delivered).toBe(false);
    expect(logged("error")).toContain("422");
    expect(logged("error")).toContain("Invalid `to` field");
  });

  it("falls back to statusText when the error body cannot be read", async () => {
    // A body that is already consumed, or a truncated response, must not throw
    // out of a send that is itself an error path.
    response = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => {
        throw new Error("body already consumed");
      },
    };

    await expect(
      sendAuthEmail(KEYED, {
        to: "alice@example.com",
        kind: "reset",
        url: "u",
      }),
    ).resolves.toBe(false);
    expect(logged("error")).toContain("Bad Gateway");
  });

  it("swallows a network failure, logging the message", async () => {
    fetchError = new Error("getaddrinfo ENOTFOUND api.resend.com");

    await expect(
      sendAuthEmail(KEYED, {
        to: "alice@example.com",
        kind: "reset",
        url: "u",
      }),
    ).resolves.toBe(false);
    expect(logged("error")).toContain("ENOTFOUND");
  });

  it("stringifies a non-Error throw instead of logging undefined", async () => {
    // fetch is not the only thing that can throw here, and a thrown string
    // logged as `undefined` is a log line that says nothing.
    fetchError = "socket hang up";

    await expect(
      sendAuthEmail(KEYED, {
        to: "alice@example.com",
        kind: "verify",
        url: "u",
      }),
    ).resolves.toBe(false);
    expect(logged("error")).toContain("socket hang up");
  });
});

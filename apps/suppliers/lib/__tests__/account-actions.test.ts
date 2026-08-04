import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountUser } from "@quagga/auth/account";

import { refusal, success } from "@/test/fakes/expect";

// The portal's own account actions (lib/actions/account.ts) — the write side of
// /account/security for a supplier's PERSONAL sign-in.
//
// THE HONESTY RULE, which the file's own header states: never report success
// for something that did not happen. Two failures are silent without a test.
//
//  1. A "your password was changed" notice for a change that did NOT occur
//     trains people to ignore the real one — and the email is the only channel
//     that reaches the owner rather than the attacker who now holds the session.
//  2. The catch around `auth.api.changePassword` exists to keep the message
//     GENERIC. A precise upstream error ("wrong current password" vs "no such
//     account") turns this form into a credential oracle.
//
// `auth.api` is mocked, so nothing here proves Better Auth's own session
// lifecycle — that a rotated cookie really keeps the browser signed in is the
// persona suite's job. What is proven is this app's handling of the results.

const authApi = {
  changePassword: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }),
}));
vi.mock("@quagga/auth", () => ({
  auth: { api: authApi },
  sendSingleEmail: vi.fn(async () => undefined),
}));
vi.mock("@quagga/auth/account", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ insertNotifications: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/account", () => ({
  requirePortalAccount: vi.fn(),
  applyAuthCookies: vi.fn(),
}));

const { sendSingleEmail } = await import("@quagga/auth");
const { recordSecurityEvent } = await import("@quagga/auth/account");
const { insertNotifications } = await import("@/lib/notifications");
const { requirePortalAccount, applyAuthCookies } = await import("@/lib/account");
const { changePassword, revokeSession, revokeOtherSessions } = await import(
  "@/lib/actions/account"
);

const ACCOUNT = { id: "user-alice", email: "alice@example.com" };
const GOOD_PASSWORD = "a short sentence I remember";

beforeEach(() => {
  vi.clearAllMocks();
  // `isAuthConfigured()` is the real probe reading this — no mock, so the
  // env-less branch below is the one the app actually takes.
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.mocked(requirePortalAccount).mockResolvedValue(ACCOUNT as AccountUser);
  authApi.changePassword.mockResolvedValue({
    headers: new Headers({ "set-cookie": "session=fresh; Path=/; HttpOnly" }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("changePassword", () => {
  it("refuses when no account is signed in", async () => {
    vi.mocked(requirePortalAccount).mockRejectedValue(
      new Error("Sign in to manage your account."),
    );

    const result = await changePassword({
      currentPassword: "x",
      newPassword: GOOD_PASSWORD,
    });

    expect(refusal(result)).toBe("Sign in to manage your account.");
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("refuses honestly when auth is unconfigured, rather than pretending", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    const result = await changePassword({
      currentPassword: "x",
      newPassword: GOOD_PASSWORD,
    });

    expect(refusal(result)).toMatch(/passwords can't change/i);
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("refuses a weak password with the core policy's own words, before calling auth", async () => {
    // One password policy, three doors: the message comes from
    // @quagga/core's `assessPassword`, not from copy written here.
    const result = await changePassword({
      currentPassword: "x",
      newPassword: "short",
    });

    expect(refusal(result)).toMatch(/A little longer/);
    expect(authApi.changePassword).not.toHaveBeenCalled();
    expect(sendSingleEmail).not.toHaveBeenCalled();
  });

  it("fails CLOSED when auth throws: generic message, no notice, no email", async () => {
    // The two things that must not happen when nothing changed: a precise
    // upstream reason reaching the user (a credential oracle), and a
    // "your password was changed" notice for a change that did not occur.
    authApi.changePassword.mockRejectedValue(
      new Error("Invalid password for user 91a3 (better-auth: INVALID_PASSWORD)"),
    );

    const message = refusal(
      await changePassword({
        currentPassword: "wrong",
        newPassword: GOOD_PASSWORD,
      }),
    );

    expect(message).toBe(
      "That didn't work. Check your current password and try again.",
    );
    expect(message).not.toMatch(/better-auth|INVALID_PASSWORD|91a3/);
    expect(insertNotifications).not.toHaveBeenCalled();
    expect(sendSingleEmail).not.toHaveBeenCalled();
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("hands the rotated session cookies back, so the caller is not signed out later", async () => {
    // Calling `auth.api.*` from a server action bypasses the /api/auth route
    // handler, so Better Auth's response headers are returned to US and then
    // dropped. `changePassword` deletes every session including the caller's;
    // without this the browser keeps a cookie naming a row that no longer
    // exists and is signed out ~5 minutes later with no explanation.
    const responseHeaders = new Headers({ "set-cookie": "session=rotated" });
    authApi.changePassword.mockResolvedValue({ headers: responseHeaders });

    success(
      await changePassword({
        currentPassword: "old",
        newPassword: GOOD_PASSWORD,
      }),
    );

    expect(applyAuthCookies).toHaveBeenCalledWith(responseHeaders);
  });

  it("writes the inbox row for THIS app, sends the mail, and records the event", async () => {
    const message = success(
      await changePassword({
        currentPassword: "old",
        newPassword: GOOD_PASSWORD,
      }),
    );

    expect(message).toBe("Password changed.");

    const [, rows] = vi.mocked(insertNotifications).mock.calls[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "user-alice",
      kind: "security",
      title: "Your password was changed",
      origin: "system",
      // Changed here, so the link resolves here. A row minted with the wrong
      // app renders unlinked in every inbox that reads it.
      linkApp: "suppliers",
    });

    // The email is the point, not a nicety: whoever changed the password holds
    // the session, so the in-app notice reaches the attacker and only the mail
    // reaches the owner.
    expect(sendSingleEmail).toHaveBeenCalledWith(
      process.env,
      "alice@example.com",
      "Your AfrikaBurn password was changed",
      expect.stringContaining("Your password was changed"),
      "suppliers:email",
    );
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-alice",
      "password_changed",
    );
  });

  it("does not turn a completed change into a reported failure when the inbox write fails", async () => {
    // The password HAS changed by this point. Reporting failure would tell the
    // owner their old password still works, which is worse than a missing row.
    vi.mocked(insertNotifications).mockRejectedValue(new Error("db down"));

    const message = success(
      await changePassword({
        currentPassword: "old",
        newPassword: GOOD_PASSWORD,
      }),
    );

    expect(message).toBe("Password changed.");
    // …and the email, the channel that actually reaches the owner, still went.
    expect(sendSingleEmail).toHaveBeenCalled();
  });

  it("skips the email for an account with no address on file", async () => {
    vi.mocked(requirePortalAccount).mockResolvedValue({
      id: "user-alice",
      email: null,
    } as AccountUser);

    success(
      await changePassword({
        currentPassword: "old",
        newPassword: GOOD_PASSWORD,
      }),
    );

    expect(sendSingleEmail).not.toHaveBeenCalled();
    expect(insertNotifications).toHaveBeenCalled();
  });
});

describe("revokeSession", () => {
  it("refuses when no account is signed in", async () => {
    vi.mocked(requirePortalAccount).mockRejectedValue(
      new Error("Sign in to manage your account."),
    );

    expect(refusal(await revokeSession({ token: "t" }))).toMatch(/Sign in/);
    expect(authApi.revokeSession).not.toHaveBeenCalled();
  });

  it("refuses when auth is unconfigured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(refusal(await revokeSession({ token: "t" }))).toBe(
      "Sign-in isn't configured yet.",
    );
    expect(authApi.revokeSession).not.toHaveBeenCalled();
  });

  it("surfaces a failed revoke honestly rather than reporting success", async () => {
    // "Session ended." for a session that is still live is the single most
    // dangerous thing this surface could say.
    authApi.revokeSession.mockRejectedValue(new Error("upstream 500"));

    expect(refusal(await revokeSession({ token: "t" }))).toBe(
      "That session couldn't be ended. Try again.",
    );
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("ends the session and records the security event", async () => {
    authApi.revokeSession.mockResolvedValue({});

    expect(success(await revokeSession({ token: "tok-1" }))).toBe(
      "Session ended.",
    );
    expect(authApi.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: "tok-1" } }),
    );
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-alice",
      "session_revoked",
    );
  });
});

describe("revokeOtherSessions", () => {
  it("refuses when no account is signed in", async () => {
    vi.mocked(requirePortalAccount).mockRejectedValue(
      new Error("Sign in to manage your account."),
    );

    expect(refusal(await revokeOtherSessions())).toMatch(/Sign in/);
    expect(authApi.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("refuses when auth is unconfigured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(refusal(await revokeOtherSessions())).toBe(
      "Sign-in isn't configured yet.",
    );
  });

  it("surfaces a failed revoke honestly", async () => {
    authApi.revokeOtherSessions.mockRejectedValue(new Error("upstream 500"));

    expect(refusal(await revokeOtherSessions())).toBe(
      "Those sessions couldn't be ended. Try again.",
    );
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("keeps the current device and says so", async () => {
    // Deliberately not "revoke all" — signing yourself out while trying to
    // secure your account is a hostile outcome, and the message says which.
    authApi.revokeOtherSessions.mockResolvedValue({});

    expect(success(await revokeOtherSessions())).toBe(
      "Every other device has been signed out.",
    );
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-alice",
      "sessions_revoked_others",
    );
  });
});

describe("the Next redirect signal", () => {
  it("is re-thrown, never rendered to the user as the literal string", async () => {
    // Next signals redirect() and notFound() by THROWING. Catching one here
    // would render "NEXT_REDIRECT" to somebody whose session had expired,
    // instead of moving them to the sign-in page. `unstable_rethrow` is what
    // distinguishes the two, and this uses the REAL one.
    const { redirect } = await import("next/navigation");
    vi.mocked(requirePortalAccount).mockImplementation(async () =>
      redirect("/auth/sign-in"),
    );

    await expect(revokeOtherSessions()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

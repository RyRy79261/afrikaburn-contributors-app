import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { CancelDeletionResult } from "@quagga/db";

import { withReauth } from "../reauth";

// THE HOOK BODIES, ACTUALLY CALLED.
//
// deletion-hook.test.ts asserts the session-create hook EXISTS, and it is
// deliberately mock-free — so it stays that way and this file is separate.
// But "a hook function exists" is precisely the shape of the B1 regression its
// own header describes: the wiring test stayed green while the hook handed a
// Better Auth TEXT id to a uuid column, Postgres refused the comparison, the
// catch swallowed it, and every sign-in silently reported nothing to cancel.
//
// Four of config.ts's six functions are these hook bodies and none of them was
// ever executed. What ships green without this file: a re-authentication that
// cancels the very deletion it is on its way to REQUEST, and a "welcome back"
// receipt mailed to a null address.
//
// Two module boundaries are stubbed and only two: ../email (so nothing is
// sent) and @quagga/db's `cancelPendingDeletion` (so nothing needs Postgres).
// `createHttpDb` stays real — it opens no connection until a query runs, which
// is what lets buildAuthOptions be called env-less at all.

const { sendAuthEmail, cancelPendingDeletion } = vi.hoisted(() => ({
  sendAuthEmail: vi.fn(async () => true),
  cancelPendingDeletion: vi.fn(
    async (): Promise<CancelDeletionResult> => ({ cancelled: false, email: null }),
  ),
}));

vi.mock("../email", () => ({ sendAuthEmail }));

vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  return { ...actual, cancelPendingDeletion };
});

const { buildAuthOptions, createAuth } = await import("../config");

beforeEach(() => {
  vi.clearAllMocks();
  cancelPendingDeletion.mockResolvedValue({ cancelled: false, email: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const USER = { email: "alice@example.com" };

// --- The email hooks ------------------------------------------------------

describe("the email hooks forward the right kind to the email seam", () => {
  it("sends a reset LINK on sendResetPassword", async () => {
    const options = buildAuthOptions({});

    await options.emailAndPassword.sendResetPassword({
      user: USER,
      url: "https://app.test/reset?token=abc",
    } as never);

    expect(sendAuthEmail).toHaveBeenCalledWith(expect.anything(), {
      to: "alice@example.com",
      kind: "reset",
      url: "https://app.test/reset?token=abc",
    });
  });

  it("sends the completed NOTICE on onPasswordReset, with no url", async () => {
    // The notice is sent after the fact and carries no token. Passing a url
    // here would put a live link in an email that exists only to say something
    // already happened.
    const options = buildAuthOptions({});

    await options.emailAndPassword.onPasswordReset({ user: USER } as never);

    expect(sendAuthEmail).toHaveBeenCalledWith(expect.anything(), {
      to: "alice@example.com",
      kind: "password-reset-completed",
    });
  });

  it("sends the verification LINK on sendVerificationEmail", async () => {
    const options = buildAuthOptions({});

    await options.emailVerification.sendVerificationEmail({
      user: USER,
      url: "https://app.test/verify?token=abc",
    } as never);

    expect(sendAuthEmail).toHaveBeenCalledWith(expect.anything(), {
      to: "alice@example.com",
      kind: "verify",
      url: "https://app.test/verify?token=abc",
    });
  });
});

// --- The sign-in promise --------------------------------------------------

describe("the session-create hook keeps the sign-in promise", () => {
  it("cancels a pending deletion in the AUTH id space, never ours", async () => {
    // `session.userId` is Better Auth's TEXT user.id. Passing it as `userId`
    // made every lookup a uuid/text comparison Postgres refused — silently,
    // because cancelPendingDeletion never throws.
    cancelPendingDeletion.mockResolvedValue({ cancelled: true, email: null });
    const after = buildAuthOptions({}).databaseHooks.session.create.after;

    await after({ userId: "auth-user-1" });

    expect(cancelPendingDeletion).toHaveBeenCalledWith({
      authUserId: "auth-user-1",
      via: "sign_in",
    });
  });

  it("stands down completely inside withReauth", async () => {
    // A password check on the way to REQUESTING deletion is not the burner
    // coming back. Without this, the request flow cancels the very deletion it
    // is about to create — and the burner is told it was scheduled.
    const after = buildAuthOptions({}).databaseHooks.session.create.after;

    await withReauth(async () => {
      await after({ userId: "auth-user-1" });
    });

    expect(cancelPendingDeletion).not.toHaveBeenCalled();
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });

  it("mails the receipt only when a deletion was actually cancelled", async () => {
    const after = buildAuthOptions({}).databaseHooks.session.create.after;

    cancelPendingDeletion.mockResolvedValue({ cancelled: true, email: "alice@example.com" });
    await after({ userId: "auth-user-1" });
    expect(sendAuthEmail).toHaveBeenCalledWith(expect.anything(), {
      to: "alice@example.com",
      kind: "deletion-cancelled",
    });

    // Nothing was rescued: an ordinary sign-in must not tell someone their
    // deletion was cancelled when they never requested one.
    vi.clearAllMocks();
    cancelPendingDeletion.mockResolvedValue({ cancelled: false, email: "alice@example.com" });
    await after({ userId: "auth-user-1" });
    expect(sendAuthEmail).not.toHaveBeenCalled();

    // Cancelled but sanitized-of-email: there is no address to send to, and
    // `to: null` would either throw in the hook or mail into the void.
    vi.clearAllMocks();
    cancelPendingDeletion.mockResolvedValue({ cancelled: true, email: null });
    await after({ userId: "auth-user-1" });
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });
});

// --- The assembled options ------------------------------------------------

describe("buildAuthOptions assembles env-dependent blocks", () => {
  it("wires Google only when BOTH the id and the secret exist", () => {
    // Half-configured Google must not mount the provider: env-less boot
    // (AGENTS.md rule 4) is what keeps all three apps starting at all.
    expect(buildAuthOptions({}).socialProviders).toBeUndefined();
    expect(buildAuthOptions({ GOOGLE_CLIENT_ID: "id" }).socialProviders).toBeUndefined();
    expect(buildAuthOptions({ GOOGLE_CLIENT_SECRET: "s" }).socialProviders).toBeUndefined();

    const options = buildAuthOptions({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" });
    expect(options.socialProviders?.google).toEqual({ clientId: "id", clientSecret: "s" });
  });

  it("scopes cookies to the apex only when actually served under it", () => {
    const apex = buildAuthOptions({
      BETTER_AUTH_URL: "https://org.quagga.ryanjnoble.dev",
    });
    expect(apex.advanced.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: ".quagga.ryanjnoble.dev",
    });
    // Setting Domain on a host that is not under the apex silently breaks every
    // cookie, so a preview/localhost deployment gets host-only cookies instead.
    expect(
      buildAuthOptions({ VERCEL_URL: "preview.vercel.app" }).advanced
        .crossSubDomainCookies,
    ).toBeUndefined();
  });

  it("drops Secure ONLY for an explicit http base URL", () => {
    // A production build served over plain http is exactly how E2E runs
    // locally; there the browser drops every __Secure- cookie and sign-up
    // "succeeds" with no session.
    expect(
      buildAuthOptions({ BETTER_AUTH_URL: "http://localhost:3000" }).advanced
        .useSecureCookies,
    ).toBe(false);
    // Env-less, the key is ABSENT rather than false, so Better Auth's own
    // secure default stands — a real deployment cannot accidentally opt out.
    expect("useSecureCookies" in buildAuthOptions({}).advanced).toBe(false);
    expect(
      "useSecureCookies" in
        buildAuthOptions({ BETTER_AUTH_URL: "https://app.quagga.ryanjnoble.dev" })
          .advanced,
    ).toBe(false);
  });

  it("keeps the rate limiter on database storage whatever the env says", () => {
    // In-memory storage is per-lambda, which is effectively no rate limiting.
    for (const env of [{}, { AUTH_RATE_LIMIT_MAX: "500" }]) {
      expect(buildAuthOptions(env).rateLimit.storage).toBe("database");
      expect(buildAuthOptions(env).rateLimit.modelName).toBe("rateLimit");
    }
    // Tuning reaches the assembled options rather than being resolved and
    // dropped on the floor.
    expect(buildAuthOptions({ AUTH_RATE_LIMIT_MAX: "500" }).rateLimit.max).toBe(500);
  });
});

describe("createAuth", () => {
  it("shouts about a missing secret rather than appearing configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAuth({});

    expect(warn.mock.calls.flat().join("\n")).toMatch(/BETTER_AUTH_SECRET/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENUMERATION_SAFE_MESSAGES } from "@quagga/core";

import type * as QuaggaDb from "@quagga/db";
import { refusal, success } from "@/test/fakes/expect";

// Self-hosted password recovery for the portal (lib/actions/password.ts).
//
// THE ENUMERATION-SAFE CONTRACT IS THE WHOLE POINT OF THE FILE, AND IT IS
// INVISIBLE. The success message must be identical whether or not the address
// exists — INCLUDING when `auth.api` throws, which is exactly the branch a
// refactor would "helpfully" surface ("no account with that email"). OWASP's
// rule, and one this repo applies at all three front doors.
//
// The rate limit exists because this is a server action calling `auth.api.*`
// IN-PROCESS: Better Auth's own HTTP limiter on /api/auth/forget-password never
// sees the request, so without this the three apps' forgot-password forms are
// an unmetered oracle-and-mail-cannon.

const authApi = {
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
};
const consumeRateLimit = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }),
}));
vi.mock("@quagga/auth", () => ({ auth: { api: authApi } }));
vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<typeof QuaggaDb>("@quagga/db");
  return { ...actual, consumeRateLimit };
});

const { requestPasswordReset, resetPassword } = await import(
  "@/lib/actions/password"
);

const GOOD_PASSWORD = "a short sentence I remember";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  authApi.requestPasswordReset.mockResolvedValue({});
  authApi.resetPassword.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestPasswordReset", () => {
  it("reports honest unavailability with no mail sender configured", async () => {
    // Never claim a link was sent when nothing can send one — that leaves
    // somebody waiting on an email that does not exist. The sign-up dead-end
    // (a "check your inbox" no deployment could satisfy) is the precedent.
    vi.stubEnv("RESEND_API_KEY", "");

    const message = refusal(
      await requestPasswordReset({ email: "alice@example.com" }),
    );

    expect(message).toMatch(/isn't available yet/i);
    expect(message).toMatch(/no reset link can be sent/i);
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("reports honest unavailability when auth is unconfigured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(
      refusal(await requestPasswordReset({ email: "alice@example.com" })),
    ).toMatch(/isn't available yet/i);
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("reports the remaining wait in minutes, rounded UP", async () => {
    // 61 seconds is "2 minute(s)", never "1" — telling somebody to retry before
    // the window clears just makes them retry into another refusal.
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 61,
    });

    expect(
      refusal(await requestPasswordReset({ email: "alice@example.com" })),
    ).toBe("Too many reset requests. Try again in 2 minute(s).");
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("buckets the limit per IP, so the three front doors share one budget", async () => {
    await requestPasswordReset({ email: "alice@example.com" });

    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining("forgot_password:") }),
    );
  });

  it("returns the enumeration-safe message on success", async () => {
    expect(
      success(await requestPasswordReset({ email: "alice@example.com" })),
    ).toBe(ENUMERATION_SAFE_MESSAGES.forgot_password);
  });

  it("returns the SAME message when the upstream call throws", async () => {
    // The load-bearing case. A caller must not be able to tell an existing
    // account from a missing one by the response.
    authApi.requestPasswordReset.mockRejectedValue(
      new Error("USER_NOT_FOUND: no user with email nobody@example.com"),
    );

    const forExisting = success(
      await requestPasswordReset({ email: "alice@example.com" }),
    );

    authApi.requestPasswordReset.mockResolvedValue({});
    const forMissing = success(
      await requestPasswordReset({ email: "nobody@example.com" }),
    );

    expect(forExisting).toBe(forMissing);
    expect(forExisting).toBe(ENUMERATION_SAFE_MESSAGES.forgot_password);
  });

  it("defaults the redirect to the portal's own reset screen", async () => {
    await requestPasswordReset({ email: "alice@example.com" });

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: "alice@example.com",
        redirectTo: "/auth/reset-password",
      },
    });
  });

  it("refuses a value that is not an email address at the boundary", async () => {
    await expect(
      requestPasswordReset({ email: "not-an-address" }),
    ).rejects.toThrow();
  });
});

describe("resetPassword", () => {
  it("refuses when auth is unconfigured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(
      refusal(await resetPassword({ token: "t", newPassword: GOOD_PASSWORD })),
    ).toBe("Sign-in isn't configured yet.");
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("refuses a weak password with the core policy's own words, before calling auth", async () => {
    const message = refusal(
      await resetPassword({ token: "t", newPassword: "short" }),
    );

    expect(message).toMatch(/A little longer/);
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("gives an expired or already-used token its own distinct message", async () => {
    // Unlike the request side, this is NOT enumeration-sensitive: the person
    // holding the link already proved they hold it, and "your link expired" is
    // the only thing that tells them to ask for another.
    authApi.resetPassword.mockRejectedValue(new Error("INVALID_TOKEN"));

    expect(
      refusal(await resetPassword({ token: "stale", newPassword: GOOD_PASSWORD })),
    ).toBe(
      "That reset link has expired or has already been used. Request a new one.",
    );
  });

  it("confirms the reset and points at signing in again", async () => {
    expect(
      success(await resetPassword({ token: "fresh", newPassword: GOOD_PASSWORD })),
    ).toBe("Password reset. Sign in with your new password.");
    expect(authApi.resetPassword).toHaveBeenCalledWith({
      body: { token: "fresh", newPassword: GOOD_PASSWORD },
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE SELF-SERVICE SECURITY SURFACE — the staff member's own password, devices
 * and passkeys.
 *
 * Two properties this file exists for:
 *
 *   · `emailVerified === true`, LITERALLY. That expression is what gates the
 *     GOD_EMAILS bootstrap, so a coercion bug there turns an attacker-asserted
 *     email claim into the highest privilege in the deployment.
 *   · NEVER REPORT SUCCESS FOR SOMETHING THAT DID NOT HAPPEN. A revoke that
 *     says "Session ended." without ending it leaves a stolen session live
 *     while telling its owner it is gone, and a false "your password was
 *     changed" notice trains people to ignore the real one.
 *
 * OUT OF SCOPE HERE, and stated rather than faked: the real better-auth round
 * trips (`changePassword`, `revokeSession`, `requestPasswordReset`) need a live
 * session store and a mail provider. Those are `pnpm e2e:local`'s. What is
 * reachable is every refusal in front of them, which is the part that decides.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

// `@quagga/auth` builds a better-auth instance at import time; `next/headers`
// throws outside a request. Both are the seam, not the subject.
const changePasswordApi = vi.fn();
const revokeSessionApi = vi.fn();
const revokeOtherSessionsApi = vi.fn();
const getSession = vi.fn();
const requestPasswordResetApi = vi.fn();
const resetPasswordApi = vi.fn();
vi.mock("@quagga/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      requestPasswordReset: (...args: unknown[]) =>
        requestPasswordResetApi(...args),
      resetPassword: (...args: unknown[]) => resetPasswordApi(...args),
      changePassword: (...args: unknown[]) => changePasswordApi(...args),
      revokeSession: (...args: unknown[]) => revokeSessionApi(...args),
      revokeOtherSessions: (...args: unknown[]) =>
        revokeOtherSessionsApi(...args),
    },
  },
}));

const resolveAccountUser = vi.fn();
const recordSecurityEvent = vi.fn();
const listAccountSessionsApi = vi.fn();
const listAccountPasskeysApi = vi.fn();
const listLinkedAccountsApi = vi.fn();
vi.mock("@quagga/auth/account", () => ({
  resolveAccountUser: (...args: unknown[]) => resolveAccountUser(...args),
  recordSecurityEvent: (...args: unknown[]) => recordSecurityEvent(...args),
  listAccountSessions: (...args: unknown[]) => listAccountSessionsApi(...args),
  listAccountPasskeys: (...args: unknown[]) => listAccountPasskeysApi(...args),
  listLinkedAccounts: (...args: unknown[]) => listLinkedAccountsApi(...args),
  parseSetCookies: () => [],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  getOrgAccountHoldings,
  listAccountPasskeys,
  listAccountSessions,
  listLinkedAccounts,
  requireConsoleAccount,
  resolveConsoleAccount,
} from "@/lib/account";
import {
  changePassword,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/actions/account";
import { requestPasswordReset, resetPassword } from "@/lib/actions/password";

const ENV = { ...process.env };
const ACCOUNT = { id: "user-1", email: "alice@example.com" };

beforeEach(() => {
  db = fakeDb();
  process.env.BETTER_AUTH_SECRET = "secret";
  process.env.DATABASE_URL = "postgres://localhost/quagga";
  delete process.env.RESEND_API_KEY;
  for (const fn of [
    changePasswordApi,
    revokeSessionApi,
    revokeOtherSessionsApi,
    resolveAccountUser,
    recordSecurityEvent,
    listAccountSessionsApi,
    listAccountPasskeysApi,
    listLinkedAccountsApi,
    getSession,
    requestPasswordResetApi,
    resetPasswordApi,
  ]) {
    fn.mockReset();
  }
  getSession.mockResolvedValue({
    user: { id: "auth-1", email: "alice@example.com", emailVerified: true },
  });
  resolveAccountUser.mockResolvedValue(ACCOUNT);
  changePasswordApi.mockResolvedValue({ headers: new Headers() });
  revokeSessionApi.mockResolvedValue({});
  revokeOtherSessionsApi.mockResolvedValue({});
  listAccountSessionsApi.mockResolvedValue([]);
  listAccountPasskeysApi.mockResolvedValue([]);
  listLinkedAccountsApi.mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...ENV };
});

/**
 * `lib/auth.ts` is imported through a fresh module registry per case so the
 * `cache()` around `getAuthenticatedUser` cannot carry a result between them.
 */
async function authModule() {
  vi.resetModules();
  vi.doMock("@quagga/auth", () => ({
    auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
  }));
  return import("@/lib/auth");
}

describe("toAuthenticatedUser — the shape the god bootstrap reads", () => {
  it("treats emailVerified as true ONLY when it is literally true", async () => {
    // This is the expression that gates the highest privilege in the system.
    // A truthy coercion here (`"false"`, `1`, `"yes"`) turns an
    // attacker-asserted claim into a System manager.
    const { getAuthenticatedUser } = await authModule();

    for (const value of [true]) {
      getSession.mockResolvedValue({
        user: { id: "auth-1", emailVerified: value },
      });
      const user = await getAuthenticatedUser();
      expect(user?.emailVerified).toBe(true);
    }

    for (const value of [false, null, undefined, "true", 1, "yes"]) {
      const mod = await authModule();
      getSession.mockResolvedValue({
        user: { id: "auth-1", emailVerified: value },
      });
      const user = await mod.getAuthenticatedUser();
      expect(user?.emailVerified).toBe(false);
    }
  });

  it("returns null for a session with no user id", async () => {
    const { getAuthenticatedUser } = await authModule();
    getSession.mockResolvedValue({ user: { email: "a@example.com" } });
    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });

  it("maps a missing email and name to null rather than undefined", async () => {
    const { getAuthenticatedUser } = await authModule();
    getSession.mockResolvedValue({ user: { id: "auth-1" } });
    await expect(getAuthenticatedUser()).resolves.toEqual({
      id: "auth-1",
      primaryEmail: null,
      displayName: null,
      emailVerified: false,
    });
  });

  it("returns null WITHOUT asking when auth is unconfigured", async () => {
    // Hard rule 4: the gate renders env-lessly rather than crashing.
    delete process.env.BETTER_AUTH_SECRET;
    const { getAuthenticatedUser } = await authModule();
    await expect(getAuthenticatedUser()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns null, never throws, when the session read fails", async () => {
    const { getAuthenticatedUser } = await authModule();
    getSession.mockRejectedValue(new Error("session store unreachable"));
    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });
});

describe("the account surface is NOT gated on holding a console role", () => {
  it("resolves the signed-in identity and refuses only when there is none", async () => {
    // An organiser whose role was revoked this morning must still be able to
    // sign out the laptop they left at the burn. The account outlives the role.
    await expect(requireConsoleAccount()).resolves.toEqual(ACCOUNT);

    resolveAccountUser.mockResolvedValue(null);
    await expect(requireConsoleAccount()).rejects.toThrow(
      "Sign in to manage your account.",
    );
  });

  it("resolves to null when nobody is signed in at all", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(resolveConsoleAccount()).resolves.toBeNull();
  });

  it("passes the request's headers to each lister", async () => {
    // Every one of these is scoped by Better Auth to the CALLING session — a
    // token from another account cannot be listed or revoked through this one.
    await listAccountSessions();
    await listAccountPasskeys();
    await listLinkedAccounts();

    expect(listAccountSessionsApi).toHaveBeenCalledWith(expect.any(Headers));
    expect(listAccountPasskeysApi).toHaveBeenCalledWith(expect.any(Headers));
    expect(listLinkedAccountsApi).toHaveBeenCalledWith(expect.any(Headers));
  });
});

describe("getOrgAccountHoldings", () => {
  it("EXCLUDES SANITIZED ACCOUNTS from the System manager count", async () => {
    // The exclusion is the whole point and is not defensive coding: a sanitized
    // account keeps its `god` membership row, so counting memberships alone
    // once let the last two System managers delete each other while the count
    // still read two — stranding the deployment with no way back, because the
    // console deliberately refuses to grant `god`.
    db.seed("groups", [{ id: "org-1" }]);
    db.seed("memberships", [
      [{ id: "mem-1", role: "god" }],
      // The live-god count, already filtered on `sanitized_at IS NULL`.
      [{ count: 1 }],
    ]);
    db.seed("org_role_assignments", [{ count: 3 }]);

    const holdings = await getOrgAccountHoldings("user-1");

    expect(holdings).toEqual({
      rank: "god",
      roleCount: 3,
      isSystemManager: true,
      liveSystemManagers: 1,
    });
  });

  it("reports nothing for an account with no org membership", async () => {
    db.seed("groups", [{ id: "org-1" }]);
    db.seed("memberships", [[], [{ count: 2 }]]);

    const holdings = await getOrgAccountHoldings("user-1");

    expect(holdings).toMatchObject({
      rank: null,
      roleCount: 0,
      isSystemManager: false,
      liveSystemManagers: 2,
    });
    // A membership-less account has no assignments to count.
    expect(db.recorded("select", "org_role_assignments")).toHaveLength(0);
  });

  it("treats a plain `member` membership as no console rank", async () => {
    db.seed("groups", [{ id: "org-1" }]);
    db.seed("memberships", [[{ id: "mem-1", role: "member" }], [{ count: 0 }]]);
    db.seed("org_role_assignments", [{ count: 0 }]);

    const holdings = await getOrgAccountHoldings("user-1");
    expect(holdings.rank).toBeNull();
  });

  it("UNDERSTATES rather than breaks the page when the read fails", async () => {
    // This is a disclosure shown before somebody walks to another app and
    // confirms a deletion; claiming something that was not read would be worse
    // than claiming nothing.
    db.fail("groups");

    await expect(getOrgAccountHoldings("user-1")).resolves.toEqual({
      rank: null,
      roleCount: 0,
      isSystemManager: false,
      liveSystemManagers: 0,
    });
  });

  it("returns the empty disclosure when no org group is seeded", async () => {
    db.seed("groups", []);
    const holdings = await getOrgAccountHoldings("user-1");
    expect(holdings.liveSystemManagers).toBe(0);
  });
});

describe("changePassword", () => {
  const INPUT = {
    currentPassword: "old-password",
    newPassword: "a-much-longer-passphrase-2027",
    revokeOtherSessions: true,
  };

  it("refuses on an env-less deployment, before assessing anything", async () => {
    // `BETTER_AUTH_SECRET` is the same variable both checks read, and the
    // identity resolve runs first — so an unconfigured deployment refuses at
    // the sign-in step and the `isAuthConfigured` guard behind it is a second
    // belt on the same strap. Either way nothing reaches the provider.
    delete process.env.BETTER_AUTH_SECRET;

    const result = await changePassword(INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Sign in to manage your account.",
    });
    expect(changePasswordApi).not.toHaveBeenCalled();
  });

  it("surfaces OUR password policy, not the provider's", async () => {
    // One password policy, three doors — the same @quagga/core assessment the
    // participant app applies.
    const result = await changePassword({ ...INPUT, newPassword: "short" });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).not.toMatch(
      /better|auth\.api/i,
    );
    expect(changePasswordApi).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the provider refuses — and announces nothing", async () => {
    // If the call throws, nothing changed, so nothing is announced. A false
    // "your password was changed" notice trains people to ignore the real one.
    changePasswordApi.mockRejectedValue(new Error("invalid credentials"));

    const result = await changePassword(INPUT);

    expect(result).toEqual({
      ok: false,
      error: "That didn't work. Check your current password and try again.",
    });
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("keeps the refusal generic, so it is not a credential oracle", async () => {
    changePasswordApi.mockRejectedValue(
      new Error("user alice@example.com: password mismatch"),
    );
    const result = await changePassword(INPUT);
    expect((result as { error: string }).error).not.toContain(
      "alice@example.com",
    );
  });

  it("announces the change, records the security event, and says so", async () => {
    const result = await changePassword(INPUT);

    expect(result).toEqual({ ok: true, message: "Password changed." });
    const [row] = db.inserted("notifications") as { linkApp: string }[];
    // The console is where the change was made, so the console is where the
    // notification's link should land.
    expect(row?.linkApp).toBe("org");
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-1",
      "password_changed",
    );
  });

  it("still reports success when the security NOTICE fails to write", async () => {
    // The password has already changed by then; a failed inbox write must not
    // turn a completed security change into a reported failure.
    db.fail("notifications");
    await expect(changePassword(INPUT)).resolves.toEqual({
      ok: true,
      message: "Password changed.",
    });
  });

  it("refuses a caller with no signed-in identity", async () => {
    resolveAccountUser.mockResolvedValue(null);
    await expect(changePassword(INPUT)).resolves.toEqual({
      ok: false,
      error: "Sign in to manage your account.",
    });
  });
});

describe("session revocation", () => {
  it("refuses both on an env-less deployment, and revokes nothing", async () => {
    delete process.env.BETTER_AUTH_SECRET;

    expect((await revokeSession({ token: "tok" })).ok).toBe(false);
    expect((await revokeOtherSessions()).ok).toBe(false);

    expect(revokeSessionApi).not.toHaveBeenCalled();
    expect(revokeOtherSessionsApi).not.toHaveBeenCalled();
  });

  it("REPORTS A FAILED REVOKE rather than claiming the device is gone", async () => {
    // "Session ended." over a session that is still live leaves a stolen
    // session in place while telling its owner it is not.
    revokeSessionApi.mockRejectedValue(new Error("no such token"));

    await expect(revokeSession({ token: "tok" })).resolves.toEqual({
      ok: false,
      error: "That session couldn't be ended. Try again.",
    });
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("reports a failed bulk revoke the same way", async () => {
    revokeOtherSessionsApi.mockRejectedValue(new Error("upstream"));
    await expect(revokeOtherSessions()).resolves.toEqual({
      ok: false,
      error: "Those sessions couldn't be ended. Try again.",
    });
  });

  it("confirms a real revoke and records the security event", async () => {
    await expect(revokeSession({ token: "tok" })).resolves.toEqual({
      ok: true,
      message: "Session ended.",
    });
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.any(Headers),
      "user-1",
      "session_revoked",
    );

    await expect(revokeOtherSessions()).resolves.toEqual({
      ok: true,
      message: "Every other device has been signed out.",
    });
    expect(recordSecurityEvent).toHaveBeenLastCalledWith(
      expect.any(Headers),
      "user-1",
      "sessions_revoked_others",
    );
  });

  it("rejects an empty token at the zod boundary", async () => {
    const result = await revokeSession({ token: "" });
    expect(result.ok).toBe(false);
    expect(revokeSessionApi).not.toHaveBeenCalled();
  });
});

/**
 * PASSWORD RECOVERY. The real round trip needs better-auth plus a mail provider
 * and belongs to `pnpm e2e:local`; what is reachable here is every refusal in
 * front of it — and the refusals are the security property, because each one
 * must be answerable without revealing whether an account exists.
 */
describe("requestPasswordReset", () => {
  it("is HONESTLY UNAVAILABLE without a mail provider", async () => {
    // A refusal that is not account-specific, so it leaks nothing — and it is
    // the truth: the link can only reach the person by email.
    delete process.env.RESEND_API_KEY;

    const result = await requestPasswordReset({ email: "alice@example.com" });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/isn't available yet/);
    expect(requestPasswordResetApi).not.toHaveBeenCalled();
  });

  it("refuses a malformed address at the zod boundary", async () => {
    await expect(
      requestPasswordReset({ email: "not-an-address" }),
    ).rejects.toThrow();
    expect(requestPasswordResetApi).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("refuses when auth is unconfigured", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(
      resetPassword({ token: "tok", newPassword: "a-much-longer-passphrase" }),
    ).resolves.toEqual({ ok: false, error: "Sign-in isn't configured yet." });
    expect(resetPasswordApi).not.toHaveBeenCalled();
  });

  it("applies the SAME password policy as every other door", async () => {
    const result = await resetPassword({ token: "tok", newPassword: "short" });
    expect(result).toMatchObject({ ok: false });
    expect(resetPasswordApi).not.toHaveBeenCalled();
  });

  it("says the link is spent rather than echoing the provider's error", async () => {
    resetPasswordApi.mockRejectedValue(new Error("token not found for alice"));

    const result = await resetPassword({
      token: "tok",
      newPassword: "a-much-longer-passphrase-2027",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "That reset link has expired or has already been used. Request a new one.",
    });
    // It must not name the account the token belonged to.
    expect((result as { error: string }).error).not.toContain("alice");
  });

  it("confirms a completed reset", async () => {
    resetPasswordApi.mockResolvedValue({});
    await expect(
      resetPassword({
        token: "tok",
        newPassword: "a-much-longer-passphrase-2027",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Password reset. Sign in with your new password.",
    });
  });

  it("rejects an empty token before calling the provider", async () => {
    await expect(
      resetPassword({
        token: "",
        newPassword: "a-much-longer-passphrase-2027",
      }),
    ).rejects.toThrow();
    expect(resetPasswordApi).not.toHaveBeenCalled();
  });
});

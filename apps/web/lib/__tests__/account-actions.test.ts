import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { DELETION_GRACE_PERIOD_DAYS } from "@quagga/core";
import { boundStrings, dbMock, uniqueViolation } from "@/test/db-mock";
import { authMock } from "@/test/auth-mock";
import { resetNextMocks, revalidated } from "@/test/next-mocks";
import { hashToken } from "../account-tokens";

// The seams. `next/navigation` stays REAL: `unstable_rethrow` recognising a
// Next control-flow error is one of the behaviours under test.
vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);
vi.mock("@quagga/auth", async () =>
  (await import("@/test/auth-mock")).authModuleMock(),
);
vi.mock("next/headers", async () =>
  (await import("@/test/next-mocks")).nextHeadersMock(),
);
vi.mock("next/cache", async () =>
  (await import("@/test/next-mocks")).nextCacheMock(),
);

const stubs = vi.hoisted(() => ({
  /** What `requireCampUser` answers, or an Error it throws. */
  campUser: null as unknown,
  rateLimit: { allowed: true, retryAfterSeconds: 0 },
  cancelled: true,
  emailConfigured: true,
  linkedAccounts: [{ providerId: "credential" }] as { providerId: string }[],
  guardContext: {
    ledProjects: [] as unknown[],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 1,
  },
  existingDeletionRequest: null as unknown,
  sent: [] as { to: string | string[]; subject: string }[],
}));

vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  return {
    ...actual,
    consumeRateLimit: async () => stubs.rateLimit,
    cancelPendingDeletion: async () => ({ cancelled: stubs.cancelled }),
  };
});

vi.mock("@/lib/session", () => ({
  requireCampUser: async () => {
    if (stubs.campUser instanceof Error) throw stubs.campUser;
    return stubs.campUser;
  },
}));

vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => stubs.emailConfigured,
  sendEmail: async (input: { to: string | string[]; subject: string }) => {
    stubs.sent.push(input);
    return { ok: true, id: "mail-1", delivered: true };
  },
}));

vi.mock("@/lib/account", () => ({
  applyAuthCookies: async () => undefined,
  buildDeletionGuardContext: async () => stubs.guardContext,
  getDeletionRequest: async () => stubs.existingDeletionRequest,
  listLinkedAccounts: async () => stubs.linkedAccounts,
}));

const {
  changePassword,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  revokeOtherSessions,
  requestEmailChange,
  confirmEmailChange,
  revokeEmailChange,
  requestAccountDeletion,
  cancelAccountDeletion,
} = await import("../account-actions");

const USER = "cccccccc-0000-0000-0000-000000000001";
const AUTH_ID = "auth-0000-0000-0000-000000000001";
const CAMP_USER = {
  id: USER,
  authUserId: AUTH_ID,
  email: "alice@example.com",
  username: "alice",
};

const GOOD_PASSWORD = "correct horse battery staple";

/** Every notification and security-event write this module makes. */
function securityEvents() {
  return dbMock.writesTo(schema.securityEvents);
}
function notifications() {
  return dbMock.writesTo(schema.notifications);
}

beforeEach(() => {
  dbMock.reset();
  authMock.reset();
  resetNextMocks();
  stubs.campUser = CAMP_USER;
  stubs.rateLimit = { allowed: true, retryAfterSeconds: 0 };
  stubs.cancelled = true;
  stubs.emailConfigured = true;
  stubs.linkedAccounts = [{ providerId: "credential" }];
  stubs.guardContext = {
    ledProjects: [],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 1,
  };
  stubs.existingDeletionRequest = null;
  stubs.sent = [];
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the run() wrapper — Next control flow is not an error string", () => {
  it("rethrows a redirect instead of rendering NEXT_REDIRECT to a burner", async () => {
    // `requireCampUser()` redirects to /auth/sign-in and is the first line of
    // nearly every action here, so catching its throw turned an expired session
    // into the literal text "NEXT_REDIRECT" on screen.
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/auth/sign-in;307;",
    });
    stubs.campUser = redirectError;

    await expect(revokeOtherSessions()).rejects.toBe(redirectError);
  });

  it("turns an ordinary throw into a refusal the UI can render", async () => {
    stubs.campUser = new Error("Something specific went wrong.");

    expect(await revokeOtherSessions()).toEqual({
      ok: false,
      error: "Something specific went wrong.",
    });
  });
});

describe("changePassword", () => {
  it("REFUSES a password below the policy before the provider is ever called", async () => {
    // Our message, not the provider's — and no credential is put on the wire
    // for a request we already know we will not honour.
    const result = await changePassword({
      currentPassword: "old-password",
      newPassword: "short",
    });

    expect(result.ok).toBe(false);
    expect(authMock.calls.map((c) => c.method)).not.toContain("changePassword");
    expect(notifications()).toHaveLength(0);
  });

  it("FAILS CLOSED on a provider throw: generic message, no notification, no event", async () => {
    // Nothing changed, so nothing is announced. A false "your password was
    // changed" trains people to ignore the real one — and a precise upstream
    // error would be a credential oracle.
    authMock.apiResults.set(
      "changePassword",
      new Error("INVALID_PASSWORD: current password mismatch"),
    );

    expect(
      await changePassword({
        currentPassword: "wrong",
        newPassword: GOOD_PASSWORD,
      }),
    ).toEqual({
      ok: false,
      error: "That didn't work. Check your current password and try again.",
    });
    expect(notifications()).toHaveLength(0);
    expect(securityEvents()).toHaveLength(0);
  });

  it("announces a change that DID happen, in the inbox and the log", async () => {
    authMock.apiResults.set("changePassword", { headers: new Headers() });

    expect(
      await changePassword({
        currentPassword: "old-password",
        newPassword: GOOD_PASSWORD,
      }),
    ).toEqual({ ok: true, message: "Password changed." });

    expect(notifications()).toHaveLength(1);
    expect(securityEvents()[0]!.arg("values")).toMatchObject({
      userId: USER,
      kind: "password_changed",
    });
    expect(revalidated.map((r) => r.path)).toContain("/account/security");
  });

  it("refuses outright when auth is not configured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    const result = await changePassword({
      currentPassword: "old-password",
      newPassword: GOOD_PASSWORD,
    });
    expect(result).toEqual({
      ok: false,
      error: "Sign-in isn't configured yet, so passwords can't change.",
    });
  });
});

describe("requestPasswordReset — enumeration safety", () => {
  it("is HONESTLY UNAVAILABLE with no email sender, and says so without naming an account", async () => {
    // The reset link can only reach someone by email, so with no provider this
    // presents as unavailable rather than claiming a link was sent. The refusal
    // is identical for every address, so it leaks nothing.
    stubs.emailConfigured = false;

    const known = await requestPasswordReset({ email: "alice@example.com" });
    const unknown = await requestPasswordReset({ email: "nobody@example.com" });

    expect(known).toEqual(unknown);
    expect(known.ok).toBe(false);
    expect(authMock.calls).toHaveLength(0);
  });

  it("ships the SAME message whether or not the account exists", async () => {
    const known = await requestPasswordReset({ email: "alice@example.com" });

    // The provider throwing for an unknown address is deliberately DISCARDED —
    // the swallowed throw is the point, not an oversight.
    authMock.apiResults.set(
      "requestPasswordReset",
      new Error("USER_NOT_FOUND"),
    );
    const unknown = await requestPasswordReset({ email: "nobody@example.com" });

    expect(known).toEqual(unknown);
    expect(known.ok).toBe(true);
  });

  it("is rate limited IN PROCESS, because a server action never meets the HTTP limiter", async () => {
    // Each accepted call queues a real email to a third party, and this path
    // bypasses the limiter configured on /api/auth/forget-password entirely.
    stubs.rateLimit = { allowed: false, retryAfterSeconds: 120 };

    const result = await requestPasswordReset({ email: "alice@example.com" });
    expect(result.ok).toBe(false);
    expect(authMock.calls).toHaveLength(0);
  });
});

describe("resetPassword", () => {
  it("REFUSES a weak password before consuming the token", async () => {
    const result = await resetPassword({ token: "tok", newPassword: "short" });
    expect(result.ok).toBe(false);
    expect(authMock.calls).toHaveLength(0);
  });

  it("reports an expired or spent link plainly", async () => {
    dbMock.queue(/* identityForResetToken */ []);
    authMock.apiResults.set("resetPassword", new Error("INVALID_TOKEN"));

    expect(
      await resetPassword({ token: "tok", newPassword: GOOD_PASSWORD }),
    ).toEqual({
      ok: false,
      error:
        "That reset link has expired or has already been used. Request a new one.",
    });
  });

  it("records the completed reset against the account it happened to", async () => {
    // The reset revokes every session, so there is no session at the moment
    // this runs — the account is resolved from the verification row instead,
    // BEFORE the provider consumes the token.
    dbMock.queue(
      /* verification row → the Better Auth user id */ [{ value: AUTH_ID }],
      /* users row for that identity */ [{ userId: USER }],
      /* the inbox row */ [],
      /* the security event */ [],
    );

    expect(
      await resetPassword({ token: "tok", newPassword: GOOD_PASSWORD }),
    ).toMatchObject({ ok: true });

    expect(securityEvents()[0]!.arg("values")).toMatchObject({
      kind: "password_reset_completed",
    });
  });

  it("still succeeds when the identity cannot be resolved — book-keeping never fails a reset", async () => {
    // The password ALREADY changed. Turning that into an error the burner reads
    // as "it didn't work" makes them retry with a token that is now spent.
    dbMock.queue(new Error("verification table unreachable"));

    expect(
      await resetPassword({ token: "tok", newPassword: GOOD_PASSWORD }),
    ).toMatchObject({ ok: true });
    expect(securityEvents()).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("revokeSession reports a provider refusal rather than claiming success", async () => {
    authMock.apiResults.set("revokeSession", new Error("nope"));

    expect(await revokeSession({ token: "session-token" })).toEqual({
      ok: false,
      error: "That session couldn't be ended. Try again.",
    });
    expect(securityEvents()).toHaveLength(0);
  });

  it("revokeOtherSessions logs the event on success", async () => {
    expect(await revokeOtherSessions()).toMatchObject({ ok: true });
    expect(securityEvents()[0]!.arg("values")).toMatchObject({
      kind: "sessions_revoked_others",
    });
  });
});

describe("requestEmailChange", () => {
  it("stores only the token HASHES — a database leak must not hand over live links", async () => {
    const result = await requestEmailChange({ newEmail: "new@example.com" });
    expect(result.ok).toBe(true);

    const insert = dbMock
      .writesTo(schema.emailChangeRequests)
      .find((q) => q.kind === "insert")!;
    const values = insert.arg("values") as {
      confirmTokenHash: string;
      revokeTokenHash: string;
      newEmail: string;
    };
    // 64 hex characters: a SHA-256 digest, not a token.
    expect(values.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(values.revokeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(values.confirmTokenHash).not.toBe(values.revokeTokenHash);

    // The confirmation link goes to the NEW address; the revocation link and
    // the inbox row go to the OLD one.
    expect(stubs.sent[0]!.to).toBe("new@example.com");
    // Supersede-then-create is ONE transaction: the partial unique index allows
    // exactly one pending row per user, so a non-atomic pair could leave the
    // burner with no request at all.
    expect(insert.tx).toBe(true);
    expect(dbMock.transactions).toBe(1);
  });

  it("REFUSES a change to the address already on the account", async () => {
    expect(await requestEmailChange({ newEmail: "ALICE@example.com" })).toEqual(
      {
        ok: false,
        error: "That's already your sign-in email.",
      },
    );
    expect(dbMock.transactions).toBe(0);
  });

  it("REFUSES when the account has no email on record", async () => {
    stubs.campUser = { ...CAMP_USER, email: null };

    expect(await requestEmailChange({ newEmail: "new@example.com" })).toEqual({
      ok: false,
      error: "This account has no email on record to change.",
    });
  });
});

describe("confirmEmailChange", () => {
  const TOKEN = "confirm-token";

  /** A request row in the state `canConfirmEmailChange` accepts. */
  function pendingRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: "ec-1",
      newEmail: "new@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      confirmedAt: null,
      revocableUntil: null,
      revokedAt: null,
      providerCommittedAt: null,
      ...overrides,
    };
  }

  it("gives ONE message for an unknown token and for a wrong-state one", async () => {
    // A token oracle is a token oracle whichever way it leaks.
    dbMock.queue([]);
    const unknown = await confirmEmailChange({ token: TOKEN });

    dbMock.reset();
    dbMock.queue([pendingRequest({ status: "revoked" })]);
    const wrongState = await confirmEmailChange({ token: TOKEN });

    dbMock.reset();
    dbMock.queue([pendingRequest({ expiresAt: new Date(Date.now() - 1000) })]);
    const expired = await confirmEmailChange({ token: TOKEN });

    expect(unknown).toEqual({
      ok: false,
      error: "That link has expired or has already been used.",
    });
    expect(wrongState).toEqual(unknown);
    expect(expired).toEqual(unknown);
    expect(dbMock.transactions).toBe(0);
  });

  it("applies the address and stamps providerCommittedAt in ONE transaction", async () => {
    dbMock.queue([pendingRequest()]);

    expect(await confirmEmailChange({ token: TOKEN })).toMatchObject({
      ok: true,
    });

    // The identity row, the request row and our own users row move together —
    // only a committed identity update may stamp `providerCommittedAt`, which
    // is what the tombstone reads.
    const identity = dbMock.writesTo(schema.user)[0]!;
    expect(identity.arg("set")).toMatchObject({
      email: "new@example.com",
      emailVerified: true,
    });
    expect(identity.tx).toBe(true);

    const request = dbMock
      .writesTo(schema.emailChangeRequests)
      .find((q) => q.kind === "update")!;
    const set = request.arg("set") as Record<string, unknown>;
    expect(set.status).toBe("confirmed");
    expect(set.providerCommittedAt).toBeInstanceOf(Date);

    expect(dbMock.writesTo(schema.users)).toHaveLength(1);
  });

  it("says the address is taken when the identity write hits a unique violation", async () => {
    dbMock.queue([pendingRequest()], uniqueViolation("user_email_unique"));

    const result = await confirmEmailChange({ token: TOKEN });
    expect(result).toEqual({
      ok: false,
      error:
        "That address can't be used — it may already be linked to another account.",
    });
    // Nothing was announced, because nothing committed.
    expect(securityEvents()).toHaveLength(0);
  });

  it("looks the request up by the HASH of the presented token", async () => {
    dbMock.queue([pendingRequest()]);
    await confirmEmailChange({ token: TOKEN });

    const bound = boundStrings(dbMock.queries[0]!);
    expect(bound).toContain(hashToken(TOKEN));
    expect(bound).not.toContain(TOKEN);
  });
});

describe("revokeEmailChange — the mirror of confirm", () => {
  const TOKEN = "revoke-token";

  function confirmedRequest(overrides: Record<string, unknown> = {}) {
    const confirmedAt = new Date(Date.now() - 60 * 60 * 1000);
    return {
      id: "ec-1",
      userId: USER,
      currentEmail: "alice@example.com",
      status: "confirmed",
      expiresAt: new Date(Date.now() - 30 * 60 * 1000),
      confirmedAt,
      revocableUntil: new Date(Date.now() + 47 * 60 * 60 * 1000),
      revokedAt: null,
      providerCommittedAt: confirmedAt,
      ...overrides,
    };
  }

  it("REFUSES an unknown token", async () => {
    dbMock.queue([]);
    expect(await revokeEmailChange({ token: TOKEN })).toEqual({
      ok: false,
      error: "That link is no longer valid.",
    });
  });

  it("REFUSES once the 48-hour window has passed", async () => {
    dbMock.queue([
      confirmedRequest({
        revocableUntil: new Date(Date.now() - 1000),
      }),
    ]);

    const result = await revokeEmailChange({ token: TOKEN });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringContaining("48-hour window"),
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("PUTS THE ADDRESS BACK, not just the paperwork", async () => {
    // It used to flip the request row and say "your sign-in email is back to
    // what it was" while `user.email` still held the NEW address. For someone
    // whose session was stolen, that sentence was the difference between
    // getting help and believing they already had their account back.
    dbMock.queue(
      /* the request */ [confirmedRequest()],
      /* the owner's auth id */ [{ authUserId: AUTH_ID }],
      /* compare-and-set … returning */ [{ id: "ec-1" }],
    );

    expect(await revokeEmailChange({ token: TOKEN })).toEqual({
      ok: true,
      message: "Reversed. Your sign-in email is back to what it was.",
    });

    expect(dbMock.writesTo(schema.user)[0]!.arg("set")).toMatchObject({
      email: "alice@example.com",
      emailVerified: true,
    });
    expect(dbMock.writesTo(schema.users)[0]!.arg("set")).toEqual({
      email: "alice@example.com",
    });
  });

  it("STOPS a still-pending request without inventing a restore", async () => {
    // Nothing has been applied, so there is no identity change to put back;
    // claiming one would be the mirror image of the lie being fixed.
    dbMock.queue(
      [confirmedRequest({ status: "pending", providerCommittedAt: null })],
      [{ id: "ec-1" }],
    );

    expect(await revokeEmailChange({ token: TOKEN })).toEqual({
      ok: true,
      message: "Stopped. Your sign-in email is unchanged.",
    });
    expect(dbMock.writesTo(schema.user)).toHaveLength(0);
  });

  it("REFUSES the second click of the same link — the compare-and-set", async () => {
    // Two clicks (or a click racing the confirm link) could each pass the guard
    // and each write the address back, announcing two reversals for one event.
    dbMock.queue(
      [confirmedRequest()],
      [{ authUserId: AUTH_ID }],
      /* nothing moved */ [],
    );

    expect(await revokeEmailChange({ token: TOKEN })).toEqual({
      ok: false,
      error: "That link is no longer valid.",
    });
    expect(dbMock.writesTo(schema.user)).toHaveLength(0);
  });

  it("says the old address has been CLAIMED SINCE rather than reporting a reversal", async () => {
    dbMock.queue(
      [confirmedRequest()],
      [{ authUserId: AUTH_ID }],
      [{ id: "ec-1" }],
      uniqueViolation("user_email_unique"),
    );

    const result = await revokeEmailChange({ token: TOKEN });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringContaining("Nothing has been changed"),
    });
  });

  it("refuses when the account behind the link cannot be resolved", async () => {
    dbMock.queue([confirmedRequest()], /* no users row */ []);

    const result = await revokeEmailChange({ token: TOKEN });
    expect(result.ok).toBe(false);
    expect(dbMock.transactions).toBe(0);
  });
});

describe("requestAccountDeletion", () => {
  it("REFUSES a password account that sent no password, without calling the provider", async () => {
    expect(await requestAccountDeletion({})).toEqual({
      ok: false,
      error: "Enter your password to confirm.",
    });
    expect(authMock.calls.map((c) => c.method)).not.toContain("signInEmail");
  });

  it("asks a Google-only account to type its own address instead", async () => {
    // Password-only re-auth made POPIA erasure UNREACHABLE for every
    // Google-only burner: there is no `credential` row to verify against, so
    // the page showed a password field that could never work.
    stubs.linkedAccounts = [{ providerId: "google" }];

    expect(await requestAccountDeletion({})).toEqual({
      ok: false,
      error: "Type your account email address to confirm.",
    });

    expect(
      await requestAccountDeletion({ confirmEmail: "someone@else.com" }),
    ).toEqual({
      ok: false,
      error: "That doesn't match the email address on this account.",
    });

    // The right address gets through to the guards.
    stubs.guardContext = {
      ledProjects: [],
      isOrgGod: false,
      orgGodCount: 0,
      signInMethodCount: 1,
    };
    expect(
      await requestAccountDeletion({ confirmEmail: " Alice@Example.com " }),
    ).toMatchObject({ ok: true });
  });

  it("REFUSES when a guard blocks, and schedules nothing", async () => {
    stubs.linkedAccounts = [{ providerId: "google" }];
    stubs.guardContext = {
      ledProjects: [{ groupId: "g1", name: "Mad Hatters", leadCount: 1 }],
      isOrgGod: false,
      orgGodCount: 0,
      signInMethodCount: 1,
    };

    const result = await requestAccountDeletion({
      confirmEmail: "alice@example.com",
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.accountDeletionRequests)).toHaveLength(0);
  });

  it("REFUSES a second request while one is already scheduled", async () => {
    stubs.linkedAccounts = [{ providerId: "google" }];
    stubs.existingDeletionRequest = { id: "req-1", status: "pending" };

    expect(
      await requestAccountDeletion({ confirmEmail: "alice@example.com" }),
    ).toEqual({
      ok: false,
      error: "This account is already scheduled for deletion.",
    });
    expect(dbMock.writesTo(schema.accountDeletionRequests)).toHaveLength(0);
  });

  it("commits the request and its audit row TOGETHER, with the grace period from core", async () => {
    stubs.linkedAccounts = [{ providerId: "google" }];

    const before = Date.now();
    expect(
      await requestAccountDeletion({ confirmEmail: "alice@example.com" }),
    ).toMatchObject({ ok: true });

    const request = dbMock.writesTo(schema.accountDeletionRequests)[0]!;
    const audit = dbMock.writesTo(schema.auditEvents)[0]!;
    // A scheduled deletion must never exist without the audit trail that proves
    // who asked and when, and an audit line must never claim a request that did
    // not persist.
    expect(request.tx).toBe(true);
    expect(audit.tx).toBe(true);
    expect(dbMock.transactions).toBe(1);

    const values = request.arg("values") as {
      graceEndsAt: Date;
      requestedFromApp: string;
    };
    const days = Math.round(
      (values.graceEndsAt.getTime() - before) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(DELETION_GRACE_PERIOD_DAYS);
    expect(values.requestedFromApp).toBe("web");
  });

  it("REFUSES when the re-auth password does not match", async () => {
    authMock.apiResults.set("signInEmail", new Error("INVALID_CREDENTIALS"));

    expect(await requestAccountDeletion({ password: "wrong" })).toEqual({
      ok: false,
      error: "That password didn't match. Try again.",
    });
    expect(dbMock.writesTo(schema.accountDeletionRequests)).toHaveLength(0);
  });

  it("deletes the session the re-auth check minted, leaving no usable token", async () => {
    // `signInEmail` still PERSISTS a session row even though no cookie reaches
    // the caller — a token nobody transmitted is still a usable token, and
    // account deletion is precisely when stray sessions must not survive.
    authMock.apiResults.set("signInEmail", { token: "reauth-token" });

    expect(
      await requestAccountDeletion({ password: GOOD_PASSWORD }),
    ).toMatchObject({ ok: true });

    expect(dbMock.writesTo(schema.session)).toHaveLength(1);
  });
});

describe("cancelAccountDeletion", () => {
  it("REFUSES when there is nothing scheduled", async () => {
    stubs.cancelled = false;

    expect(await cancelAccountDeletion()).toEqual({
      ok: false,
      error: "There's no deletion scheduled on this account.",
    });
    expect(stubs.sent).toHaveLength(0);
  });

  it("confirms the cancellation and mails the account", async () => {
    expect(await cancelAccountDeletion()).toEqual({
      ok: true,
      message: "Cancelled — nothing was erased.",
    });
    expect(stubs.sent).toHaveLength(1);
    expect(revalidated.map((r) => r.path)).toContain("/account/delete");
  });
});

describe("recordSecurityEvent / notifySecurity — book-keeping never rolls back", () => {
  it("a failed security-event insert does not fail the action it records", async () => {
    authMock.apiResults.set("changePassword", { headers: new Headers() });
    dbMock.queue(
      /* the inbox row */ [],
      /* the security event */ new Error("security_events is unreachable"),
    );

    expect(
      await changePassword({
        currentPassword: "old-password",
        newPassword: GOOD_PASSWORD,
      }),
    ).toEqual({ ok: true, message: "Password changed." });
  });

  it("a failed inbox write does not roll back a completed security change", async () => {
    authMock.apiResults.set("changePassword", { headers: new Headers() });
    dbMock.queue(new Error("notifications is unreachable"));

    expect(
      await changePassword({
        currentPassword: "old-password",
        newPassword: GOOD_PASSWORD,
      }),
    ).toEqual({ ok: true, message: "Password changed." });
    // …and the security event still landed.
    expect(securityEvents()).toHaveLength(1);
  });
});

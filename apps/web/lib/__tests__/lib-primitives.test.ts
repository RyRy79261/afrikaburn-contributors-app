// The small, fully deterministic modules — config probes, token crypto, the
// keypair helpers, the pending-invite cookie, the pooled-transaction seam and
// the two thin server actions. Cheap to test and several carry real
// guarantees: `safeEncrypt` returning null rather than persisting sensitive
// data in the clear, `tokensMatch` being timing-safe, and `readPendingInvite`
// validating against the token grammar so a hand-crafted cookie cannot smuggle
// a path or a scheme into the auth flow.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PENDING_INVITE_COOKIE } from "@quagga/core";
import { dbMock } from "@/test/db-mock";
import { authMock } from "@/test/auth-mock";
import { cookieJar, resetNextMocks } from "@/test/next-mocks";

const pool = vi.hoisted(() => ({ ended: 0 }));

// `lib/db.ts` itself is under test here, so it is NOT mocked. The drivers
// underneath it are: `createHttpDb` hands back the query harness, and
// `createPooledDb` hands back a fake pool whose `end()` is counted.
vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  const { dbMock: harness } = await import("@/test/db-mock");
  return {
    ...actual,
    createHttpDb: () => harness.handle,
    createPooledDb: () => ({
      db: {
        transaction: (fn: (tx: never) => Promise<unknown>) =>
          harness.runTransaction(fn),
      },
      pool: {
        end: async () => {
          pool.ended += 1;
        },
      },
    }),
  };
});

vi.mock(
  "next/headers",
  async () => (await import("@/test/next-mocks")).nextHeadersMock(),
);
vi.mock(
  "next/cache",
  async () => (await import("@/test/next-mocks")).nextCacheMock(),
);
vi.mock(
  "@quagga/auth",
  async () => (await import("@/test/auth-mock")).authModuleMock(),
);

const sent = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (input: unknown) => {
    if (sent.fail) throw new Error("Resend is down");
    sent.calls.push(input);
    return { ok: true, id: "mail-1", delivered: true };
  },
}));

const campUser = vi.hoisted(() => ({
  value: {
    id: "cccccccc-0000-0000-0000-000000000001",
    authUserId: "auth-1",
    email: "alice@example.com",
    username: "alice",
  } as unknown,
}));
vi.mock("@/lib/session", () => ({
  requireCampUser: async () => campUser.value,
}));

const {
  isAuthConfigured,
  isDatabaseConfigured,
  isFullyConfigured,
  missingConfig,
} = await import("../config");
const { isCryptoConfigured, safeEncrypt } = await import("../crypto-guard");
const { newToken, hashToken, tokensMatch } = await import("../account-tokens");
const { generateProfileKeypair, fingerprintPublicKey } = await import(
  "../keys"
);
const { setPendingInvite, readPendingInvite, clearPendingInvite } =
  await import("../pending-invite");
const { withTransaction, requireDb, db } = await import("../db");
const { getActiveEdition, getEditionLabel, FALLBACK_EDITION_LABEL } =
  await import("../edition");
const { getAuthenticatedUser, getAuthenticatedUserOrRedirect } = await import(
  "../auth"
);
const { searchCampsAction } = await import("../camp-search-action");
const { completeInviteJoin } = await import("../invite-flow");

const USER = "cccccccc-0000-0000-0000-000000000001";
/** The invite-token grammar `@quagga/core` enforces. */
const GOOD_TOKEN = "abcdefghijklmnopqrstuvwx";

beforeEach(() => {
  dbMock.reset();
  authMock.reset();
  resetNextMocks();
  pool.ended = 0;
  sent.calls = [];
  sent.fail = false;
  campUser.value = {
    id: USER,
    authUserId: "auth-1",
    email: "alice@example.com",
    username: "alice",
  };
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("PGCRYPTO_KEY", "test-pgcrypto-key-16+");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config — the env-less boot probes", () => {
  it("names each unset service and requires both to be fully configured", () => {
    expect(missingConfig()).toEqual([]);
    expect(isFullyConfigured()).toBe(true);

    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(missingConfig()).toEqual(["Better Auth (sign-in)"]);
    expect(isFullyConfigured()).toBe(false);
    expect(isAuthConfigured()).toBe(false);
    expect(isDatabaseConfigured()).toBe(true);

    vi.stubEnv("DATABASE_URL", "");
    expect(missingConfig()).toEqual([
      "Better Auth (sign-in)",
      "Neon Postgres (database)",
    ]);
  });
});

describe("crypto-guard", () => {
  it("is NOT configured for a key that is merely short, not just a missing one", () => {
    // A 15-character key throws inside the cipher; treating it as configured
    // would mean the caller believed a value was encrypted when the write blew
    // up instead.
    vi.stubEnv("PGCRYPTO_KEY", "fifteen-charss");
    expect(isCryptoConfigured()).toBe(false);

    vi.stubEnv("PGCRYPTO_KEY", "");
    expect(isCryptoConfigured()).toBe(false);
  });

  it("returns null rather than persisting sensitive data in the clear", () => {
    // The caller DROPS the value on null. Returning the plaintext here is how a
    // medical note ends up unencrypted in a column named for its ciphertext.
    vi.stubEnv("PGCRYPTO_KEY", "");
    expect(safeEncrypt("Severe bee allergy.")).toBeNull();

    vi.stubEnv("PGCRYPTO_KEY", "test-pgcrypto-key-16+");
    const ciphertext = safeEncrypt("Severe bee allergy.");
    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toContain("allergy");
  });

  it("returns null for an empty value even when a key is configured", () => {
    expect(safeEncrypt(null)).toBeNull();
    expect(safeEncrypt("")).toBeNull();
  });
});

describe("account-tokens", () => {
  it("mints distinct, URL-safe tokens", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes stably, and matches only the token the hash came from", () => {
    const token = newToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);

    expect(tokensMatch(token, hashToken(token))).toBe(true);
    expect(tokensMatch(newToken(), hashToken(token))).toBe(false);
  });

  it("refuses a stored digest of the wrong length instead of throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, which would turn a
    // corrupted row into a 500 on a confirmation link.
    expect(tokensMatch(newToken(), "deadbeef")).toBe(false);
  });
});

describe("keys", () => {
  it("generates base64 that round-trips through Buffer", async () => {
    const pair = await generateProfileKeypair();
    expect(
      Buffer.from(pair.publicKeyB64, "base64").toString("base64"),
    ).toBe(pair.publicKeyB64);
    expect(pair.privateKeyB64).not.toBe(pair.publicKeyB64);
  });

  it("fingerprints deterministically as eight colon-separated hex pairs", async () => {
    // The profile shows this next to the account; it changing between renders
    // would read as the key having changed.
    const key = Buffer.from("a-fake-public-key").toString("base64");
    const first = await fingerprintPublicKey(key);
    expect(first).toMatch(/^([0-9a-f]{2}:){7}[0-9a-f]{2}$/);
    expect(await fingerprintPublicKey(key)).toBe(first);

    const other = Buffer.from("a-different-key").toString("base64");
    expect(await fingerprintPublicKey(other)).not.toBe(first);
  });
});

describe("pending-invite — the cookie that survives the auth round trip", () => {
  it("REFUSES to store a malformed token", async () => {
    await setPendingInvite("../../etc/passwd");
    await setPendingInvite("https://evil.example.com/join");
    expect(cookieJar.entries()).toEqual([]);
  });

  it("sets httpOnly, SameSite=Lax and secure-in-production for a good one", async () => {
    // Lax, not Strict: the cookie has to survive the top-level GET back from
    // Google's OAuth callback or an emailed verification link.
    vi.stubEnv("NODE_ENV", "production");
    await setPendingInvite(GOOD_TOKEN);

    const cookie = cookieJar.get(PENDING_INVITE_COOKIE);
    expect(cookie?.value).toBe(GOOD_TOKEN);
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("is not Secure outside production, or the cookie never sets on http://localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await setPendingInvite(GOOD_TOKEN);
    expect(cookieJar.get(PENDING_INVITE_COOKIE)?.options).toMatchObject({
      secure: false,
    });
  });

  it("reads back null for a hand-crafted cookie value", async () => {
    // Validated against the grammar, so a crafted cookie cannot smuggle a path,
    // a query or a scheme into the flow.
    cookieJar.seed(PENDING_INVITE_COOKIE, "/directory?next=https://evil.test");
    expect(await readPendingInvite()).toBeNull();

    cookieJar.seed(PENDING_INVITE_COOKIE, GOOD_TOKEN);
    expect(await readPendingInvite()).toBe(GOOD_TOKEN);
  });

  it("clears unconditionally, but a TOKENED clear leaves a different invite alone", async () => {
    // Someone can have invite A mid-round-trip and then open a dead link B;
    // clearing unconditionally there throws away the invite they are actually
    // in the middle of accepting.
    cookieJar.seed(PENDING_INVITE_COOKIE, GOOD_TOKEN);
    await clearPendingInvite("zyxwvutsrqponmlkjihgfedc");
    expect(cookieJar.get(PENDING_INVITE_COOKIE)?.value).toBe(GOOD_TOKEN);

    await clearPendingInvite(GOOD_TOKEN);
    expect(cookieJar.get(PENDING_INVITE_COOKIE)).toBeUndefined();

    cookieJar.seed(PENDING_INVITE_COOKIE, GOOD_TOKEN);
    await clearPendingInvite();
    expect(cookieJar.get(PENDING_INVITE_COOKIE)).toBeUndefined();
  });
});

describe("db — the transactional seam", () => {
  it("requireDb follows DATABASE_URL", () => {
    expect(requireDb()).toBe(true);
    vi.stubEnv("DATABASE_URL", "");
    expect(requireDb()).toBe(false);
  });

  it("hands the callback a working handle and CLOSES THE POOL afterwards", async () => {
    const result = await withTransaction(async (tx) => {
      await (tx as unknown as { insert: (t: unknown) => Promise<unknown> }).insert(
        {},
      );
      return "committed";
    });

    expect(result).toBe("committed");
    expect(pool.ended).toBe(1);
  });

  it("closes the pool even when the callback THREW", async () => {
    // The socket has to be released whether the transaction committed or rolled
    // back; leaking one per failed action exhausts the pool.
    await expect(
      withTransaction(async () => {
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    expect(pool.ended).toBe(1);
  });

  it("db() hands out a usable query builder", async () => {
    dbMock.queue([{ id: "x" }]);
    expect(
      await (db() as unknown as { select: () => Promise<unknown> }).select(),
    ).toEqual([{ id: "x" }]);
  });
});

describe("edition", () => {
  it("falls back to the most recent edition when none is flagged active", async () => {
    dbMock.queue([], [{ id: "e-2026", name: "AfrikaBurn 2026", year: 2026 }]);
    expect((await getActiveEdition())?.id).toBe("e-2026");
  });

  it("is null when the table is empty", async () => {
    dbMock.queue([], []);
    expect(await getActiveEdition()).toBeNull();
  });

  it("renders the banner from the active edition's dates", async () => {
    dbMock.queue([
      {
        id: "e-2027",
        name: "AfrikaBurn 2027",
        year: 2027,
        startDate: "2027-04-26",
        endDate: "2027-05-02",
        isActive: true,
      },
    ]);

    expect(await getEditionLabel()).toBe(
      "AfrikaBurn 2027 · 26 April – 2 May 2027",
    );
  });

  it("falls back to the static label env-lessly, on an empty table, and on a throw", async () => {
    // The env-less boot law: a banner must render before anything is seeded.
    vi.stubEnv("DATABASE_URL", "");
    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);

    vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
    dbMock.queue([], []);
    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);

    dbMock.reset();
    dbMock.queue(new Error("connection terminated unexpectedly"));
    expect(await getEditionLabel()).toBe(FALLBACK_EDITION_LABEL);
  });
});

describe("auth", () => {
  it("is null when auth is unconfigured, without asking the provider", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(await getAuthenticatedUser()).toBeNull();
    expect(authMock.calls).toHaveLength(0);
  });

  it("is null — never a throw — when the session read fails", async () => {
    // Every public surface renders through this; a throw here is a 500 on the
    // landing page.
    authMock.sessionError = new Error("session store unreachable");
    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("treats emailVerified STRICTLY — only true counts", async () => {
    // It gates the god bootstrap, so a truthy-but-not-true value from the
    // provider must not read as verified.
    authMock.signedInAs({
      id: "auth-1",
      email: "ryan@example.com",
      name: "Ryan",
      emailVerified: null,
    });
    expect(await getAuthenticatedUser()).toEqual({
      id: "auth-1",
      primaryEmail: "ryan@example.com",
      displayName: "Ryan",
      emailVerified: false,
    });
  });

  it("is null for a session with no user id", async () => {
    authMock.session = { user: { id: "" } };
    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("redirects to sign-in when unauthenticated", async () => {
    const err = await getAuthenticatedUserOrRedirect().then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as { digest?: string }).digest).toContain(
      "NEXT_REDIRECT;replace;/auth/sign-in",
    );
  });
});

describe("searchCampsAction", () => {
  it("returns empty for a query over the length cap, before authenticating", async () => {
    expect(await searchCampsAction("x".repeat(121))).toEqual([]);
    expect(await searchCampsAction(42)).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("returns empty when no edition is active", async () => {
    dbMock.queue(/* active */ [], /* latest */ []);
    expect(await searchCampsAction("mad")).toEqual([]);
  });

  it("delegates visibility to searchCampDirectory", async () => {
    dbMock.queue(
      [{ id: "e-2027", name: "AfrikaBurn 2027", year: 2027 }],
      /* the camps */ [
        {
          id: "g-1",
          name: "Mad Hatters",
          slug: "mad-hatters",
          kind: "project",
          nameNormalized: "mad hatters",
        },
      ],
      /* approved: none */ [],
      /* the viewer is not a member */ [],
    );

    // A free camp the viewer is not in stays undiscoverable, even through the
    // type-ahead.
    expect(await searchCampsAction("mad")).toEqual([]);
  });
});

describe("completeInviteJoin", () => {
  const user = { id: USER, authUserId: "auth-1", email: "alice@example.com", username: "alice" };

  it("returns the redeem refusal unchanged and sends no welcome mail", async () => {
    dbMock.queue(/* getInvitePreview */ [], /* redeemInvite lookup */ []);

    const result = await completeInviteJoin(GOOD_TOKEN, user);
    expect(result.ok).toBe(false);
    expect(sent.calls).toHaveLength(0);
  });

  /** What a live, unclaimed `member` invite looks like coming back. */
  const inviteRow = {
    id: "inv-1",
    groupId: "g-1",
    token: GOOD_TOKEN,
    kind: "member",
    expiresAt: new Date(Date.now() + 86_400_000),
    usedAt: null,
    usedByUserId: null,
    createdByUserId: "someone",
    createdAt: new Date(),
  };

  /** The seven reads/writes a successful join makes, in order. */
  function queueSuccessfulJoin() {
    dbMock.queue(
      /* getInvitePreview */ [
        {
          token: GOOD_TOKEN,
          kind: "member",
          groupId: "g-1",
          groupName: "Mad Hatters",
          groupSlug: "mad-hatters",
          groupDescription: null,
          expiresAt: inviteRow.expiresAt,
          usedAt: null,
          usedByUserId: null,
          createdByUserId: "someone",
        },
      ],
      /* redeemInvite: the invite row */ [inviteRow],
      /* getViewerRole: not a member yet */ [],
      /* groupNameAndSlug */ [{ name: "Mad Hatters", slug: "mad-hatters" }],
      /* the atomic claim … returning */ [{ id: "inv-1" }],
      /* nextMemberRefCode */ [{ refCode: "MAH-M001" }],
      /* the membership insert */ [],
    );
  }

  it("reads the camp name BEFORE the claim, so the mail can still name the camp", async () => {
    // Redemption stamps the row, so a lookup afterwards would find a claimed
    // invite and the welcome mail would have nothing to say.
    queueSuccessfulJoin();

    const result = await completeInviteJoin(GOOD_TOKEN, user);
    expect(result).toMatchObject({ ok: true, slug: "mad-hatters" });
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]).toMatchObject({
      to: "alice@example.com",
      subject: "You've joined Mad Hatters",
    });
  });

  it("does not fail the join when the welcome mail cannot be sent", async () => {
    sent.fail = true;
    queueSuccessfulJoin();

    expect(await completeInviteJoin(GOOD_TOKEN, user)).toMatchObject({
      ok: true,
    });
  });
});

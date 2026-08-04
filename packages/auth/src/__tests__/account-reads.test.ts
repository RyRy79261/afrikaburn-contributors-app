import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import type { Database } from "@quagga/db";

// THE READ SIDE OF ACCOUNT SECURITY, proven without a database.
//
// account.ts answers "where am I signed in?", "is 2FA on?" and "how do I sign
// in at all?" for all three apps, and its header states the contract every one
// of those reads lives under: EVERY READ DEGRADES, NONE THROWS. Almost none of
// it was executed in CI — 1 of 22 functions — so both halves shipped unproven:
// the badge that says "this is the session you are sitting on" (without it the
// page renders a Revoke button on the caller's own session) and the refusal
// that stops a sanitized account reaching a surface which changes credentials.
//
// TWO MODULE BOUNDARIES ARE STUBBED, AND ONLY TWO.
//
//   @quagga/db — `createHttpDb` alone, via importActual. `schema` and drizzle's
//     `eq`/`desc` stay REAL. A whole-module factory mock would replace `schema`,
//     so `eq(schema.users.authUserId, …)` would throw inside the function's own
//     try, the catch would swallow it, and every degrade-path test below would
//     pass for the wrong reason while proving nothing at all.
//   ../config — so this file never constructs a real betterAuth() instance.
//     The consequence is worth stating: config.ts gets NO coverage from here.
//     It is covered by deletion-hook.test.ts and auth-hooks.test.ts, and if
//     both were deleted config.ts would go dark without any test failing.
//
// SQL SEMANTICS ARE OUT OF SCOPE here on purpose. Whether onConflictDoNothing
// really targets `users.auth_user_id`, and whether the order-by-desc-limit
// returns the right rows, are questions for a live Postgres (`pnpm e2e:local`).
// What is proven here is the control flow, the id spaces, the payloads actually
// handed to the driver, and every path that must degrade instead of throwing.

/** Better Auth's server API, as account.ts consumes it. */
const { api } = vi.hoisted(() => ({
  api: {
    listSessions: vi.fn(),
    getSession: vi.fn(),
    listPasskeys: vi.fn(),
    listUserAccounts: vi.fn(),
  },
}));

/** One chained call the code under test made on the fake driver. */
type DriverCall = { method: string; args: unknown[] };

let calls: DriverCall[] = [];
/** What the next awaited query resolves to. */
let dbRows: unknown = [];
/** When set, the next awaited query REJECTS — the "Neon is unreachable" path. */
let dbError: Error | null = null;

function queryStub(): Database {
  const self: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return self;
    };
  for (const m of [
    "insert",
    "values",
    "onConflictDoNothing",
    "select",
    "from",
    "where",
    "orderBy",
    "limit",
  ]) {
    self[m] = record(m);
  }
  // Thenable, so both `await db.insert(...).values(...)` and
  // `await db.select(...).from(...).limit(1)` settle on the fixture.
  self.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    (dbError ? Promise.reject(dbError) : Promise.resolve(dbRows)).then(
      res,
      rej,
    );
  return self as unknown as Database;
}

vi.mock("@quagga/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@quagga/db");
  return { ...actual, createHttpDb: () => queryStub() };
});

vi.mock("../config", () => ({ auth: { api } }));

const {
  listAccountSessions,
  listAccountPasskeys,
  listLinkedAccounts,
  resolveAccountUser,
  recordSecurityEvent,
  listSecurityEvents,
  getTwoFactorEnabled,
} = await import("../account");

/** Every `.values(payload)` the code handed the driver, in order. */
function insertedPayloads(): unknown[] {
  return calls.filter((c) => c.method === "values").map((c) => c.args[0]);
}

function methodsCalled(): string[] {
  return calls.map((c) => c.method);
}

// `authReady()` and `isDatabaseConfigured()` read process.env at CALL time, not
// at import — so each test starts from a configured stack and the "unconfigured"
// cases delete what they mean to remove.
beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  process.env.DATABASE_URL = "postgres://user:pw@localhost:5432/test";
  calls = [];
  dbRows = [];
  dbError = null;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.DATABASE_URL;
});

const NO_HEADERS = new Headers();

// --- Sessions -------------------------------------------------------------

describe("listAccountSessions", () => {
  it("flags exactly the caller's own row as current", async () => {
    // This badge is the whole reason the list is safe to render: it is what
    // stops someone revoking the session they are sitting on. Flagging the
    // wrong row, or none, turns a security page into a self-lockout button.
    api.listSessions.mockResolvedValue([
      { id: "s1", token: "tok-other" },
      { id: "s2", token: "tok-mine" },
    ]);
    api.getSession.mockResolvedValue({ session: { token: "tok-mine" } });

    const sessions = await listAccountSessions(NO_HEADERS);

    expect(sessions.map((s) => [s.id, s.current])).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
  });

  it("flags nothing when the cookie cache has no session at all", async () => {
    // Better than flagging everything: an unknown current token must produce a
    // list with no "This device" badge, never a list where every row claims it.
    api.listSessions.mockResolvedValue([{ id: "s1", token: "tok-a" }]);
    api.getSession.mockResolvedValue(null);

    const sessions = await listAccountSessions(NO_HEADERS);

    expect(sessions.every((s) => s.current === false)).toBe(true);
  });

  it("sorts newest first on updatedAt, falling back to createdAt, then to 0", async () => {
    api.listSessions.mockResolvedValue([
      {
        id: "stale",
        token: "a",
        updatedAt: "2026-01-03T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { id: "newest", token: "b", createdAt: "2026-01-05T00:00:00.000Z" },
      { id: "undated", token: "c" },
    ]);
    api.getSession.mockResolvedValue(null);

    const sessions = await listAccountSessions(NO_HEADERS);

    // "newest" has no updatedAt at all and still sorts first on its createdAt;
    // the row with neither date sorts last rather than jumping to the top.
    expect(sessions.map((s) => s.id)).toEqual(["newest", "stale", "undated"]);
  });

  it("drops a row the provider gave no token for", async () => {
    // A row with no token cannot be revoked, so rendering it would put a Revoke
    // button on the page that does nothing when pressed. The empty object is
    // the same case with nothing to fall back to at all.
    api.listSessions.mockResolvedValue([
      { id: "s1", token: null },
      {},
      { id: "s2", token: "tok-real" },
    ]);
    api.getSession.mockResolvedValue(null);

    const sessions = await listAccountSessions(NO_HEADERS);

    expect(sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it("falls back id → token when the provider omits an id", async () => {
    // The id is the React key and the revoke argument; an empty one collapses
    // two rows into one in the list.
    api.listSessions.mockResolvedValue([{ token: "tok-only" }]);
    api.getSession.mockResolvedValue(null);

    const [session] = await listAccountSessions(NO_HEADERS);

    expect(session?.id).toBe("tok-only");
  });

  it("turns an unparseable date into null, never an Invalid Date", async () => {
    // An Invalid Date renders as literal garbage in the session list; null
    // renders as the honest "unknown" the card already handles.
    api.listSessions.mockResolvedValue([
      {
        id: "s1",
        token: "t",
        createdAt: "not-a-date",
        updatedAt: null,
        expiresAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    api.getSession.mockResolvedValue(null);

    const [session] = await listAccountSessions(NO_HEADERS);

    expect(session?.createdAt).toBeNull();
    expect(session?.updatedAt).toBeNull();
    expect(session?.expiresAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("takes a Date the provider already parsed without re-parsing it", async () => {
    // The drizzle driver hands back Date objects for timestamp columns, so both
    // shapes reach this mapper depending on which layer answered.
    const createdAt = new Date("2026-04-04T04:04:04.000Z");
    api.listSessions.mockResolvedValue([{ id: "s1", token: "t", createdAt }]);
    api.getSession.mockResolvedValue(null);

    const [session] = await listAccountSessions(NO_HEADERS);

    expect(session?.createdAt?.toISOString()).toBe("2026-04-04T04:04:04.000Z");
  });

  it("carries the user agent and IP through untouched for display", async () => {
    api.listSessions.mockResolvedValue([
      {
        id: "s1",
        token: "t",
        userAgent: "Mozilla/5.0",
        ipAddress: "203.0.113.7",
      },
      { id: "s2", token: "u" },
    ]);
    api.getSession.mockResolvedValue(null);

    const sessions = await listAccountSessions(NO_HEADERS);

    expect(sessions[0]?.userAgent).toBe("Mozilla/5.0");
    expect(sessions[0]?.ipAddress).toBe("203.0.113.7");
    // Absent context is null rather than undefined, so the card's own
    // null-checks are the only branch it has to carry.
    expect(sessions[1]?.userAgent).toBeNull();
    expect(sessions[1]?.ipAddress).toBeNull();
  });

  it("returns [] without calling the provider when auth is unconfigured", async () => {
    delete process.env.BETTER_AUTH_SECRET;

    await expect(listAccountSessions(NO_HEADERS)).resolves.toEqual([]);
    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it("returns [] when the provider answers with null", async () => {
    api.listSessions.mockResolvedValue(null);
    api.getSession.mockResolvedValue(null);

    await expect(listAccountSessions(NO_HEADERS)).resolves.toEqual([]);
  });

  it("returns [] rather than throwing when the provider rejects", async () => {
    // The security page must render a degraded card. Throwing here takes down
    // the whole page, which tells the reader nothing about their account.
    api.listSessions.mockRejectedValue(new Error("auth server unreachable"));
    api.getSession.mockResolvedValue(null);

    await expect(listAccountSessions(NO_HEADERS)).resolves.toEqual([]);
  });
});

// --- Passkeys -------------------------------------------------------------

describe("listAccountPasskeys", () => {
  it("emits createdAt as an ISO string and drops id-less rows", async () => {
    api.listPasskeys.mockResolvedValue([
      {
        id: "pk1",
        name: "YubiKey",
        deviceType: "singleDevice",
        createdAt: "2026-03-04T05:06:07.000Z",
      },
      { id: null, name: "ghost" },
      { id: "pk2", createdAt: "nonsense" },
    ]);

    const passkeys = await listAccountPasskeys(NO_HEADERS);

    expect(passkeys).toEqual([
      {
        id: "pk1",
        name: "YubiKey",
        deviceType: "singleDevice",
        createdAt: "2026-03-04T05:06:07.000Z",
      },
      // An id-less row is gone; an unparseable date degrades to null instead of
      // rendering "Invalid Date" next to a credential someone may want to remove.
      { id: "pk2", name: null, deviceType: null, createdAt: null },
    ]);
  });

  it("returns [] when unconfigured, when the payload is null, and when the call rejects", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(listAccountPasskeys(NO_HEADERS)).resolves.toEqual([]);
    expect(api.listPasskeys).not.toHaveBeenCalled();

    process.env.BETTER_AUTH_SECRET = "x".repeat(40);
    api.listPasskeys.mockResolvedValue(null);
    await expect(listAccountPasskeys(NO_HEADERS)).resolves.toEqual([]);

    api.listPasskeys.mockRejectedValue(new Error("plugin not mounted"));
    await expect(listAccountPasskeys(NO_HEADERS)).resolves.toEqual([]);
  });
});

// --- Linked sign-in methods ----------------------------------------------

describe("listLinkedAccounts", () => {
  it('falls back providerId → provider → "unknown", and drops id-less rows', async () => {
    // Better Auth has shipped both key spellings; picking one and ignoring the
    // other is how the sign-in-methods list silently empties itself.
    api.listUserAccounts.mockResolvedValue([
      {
        id: "a1",
        providerId: "credential",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { id: "a2", provider: "google" },
      { id: "a3" },
      { providerId: "credential" },
    ]);

    const accounts = await listLinkedAccounts(NO_HEADERS);

    expect(accounts.map((a) => [a.id, a.providerId])).toEqual([
      ["a1", "credential"],
      ["a2", "google"],
      ["a3", "unknown"],
    ]);
    expect(accounts[0]?.createdAt?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(accounts[1]?.createdAt).toBeNull();
  });

  it("returns [] when unconfigured, when the payload is null, and when the call rejects", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(listLinkedAccounts(NO_HEADERS)).resolves.toEqual([]);
    expect(api.listUserAccounts).not.toHaveBeenCalled();

    process.env.BETTER_AUTH_SECRET = "x".repeat(40);
    api.listUserAccounts.mockResolvedValue(null);
    await expect(listLinkedAccounts(NO_HEADERS)).resolves.toEqual([]);

    api.listUserAccounts.mockRejectedValue(
      new Error("auth server unreachable"),
    );
    await expect(listLinkedAccounts(NO_HEADERS)).resolves.toEqual([]);
  });
});

// --- Who is asking --------------------------------------------------------

describe("resolveAccountUser", () => {
  it("returns the {id, authUserId, email} triple for a live account", async () => {
    dbRows = [
      { id: "user-uuid", email: "alice@example.com", sanitizedAt: null },
    ];

    await expect(
      resolveAccountUser("auth-1", "alice@example.com"),
    ).resolves.toEqual({
      id: "user-uuid",
      authUserId: "auth-1",
      // The stored email wins over the one the session carried — the row is the
      // record of what we hold, and a deletion nulls it there.
      email: "alice@example.com",
    });
  });

  it("refuses a sanitized account, which a stale cookie cache can still present", async () => {
    // The session cookie cache lives for five minutes. Without this refusal a
    // deleted account reaches a surface that changes credentials.
    dbRows = [
      {
        id: "user-uuid",
        email: null,
        sanitizedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ];

    await expect(
      resolveAccountUser("auth-1", "alice@example.com"),
    ).resolves.toBeNull();
  });

  it("upserts with onConflictDoNothing on the auth id, never DoUpdate", async () => {
    // DoUpdate here would write the session's email back over a row whose email
    // a deletion deliberately nulled — un-erasing the PII the erasure removed.
    dbRows = [
      { id: "user-uuid", email: "alice@example.com", sanitizedAt: null },
    ];

    await resolveAccountUser("auth-1", "alice@example.com");

    expect(insertedPayloads()).toEqual([
      { authUserId: "auth-1", email: "alice@example.com" },
    ]);
    expect(methodsCalled()).toContain("onConflictDoNothing");
    const conflict = calls.find((c) => c.method === "onConflictDoNothing");
    expect((conflict?.args[0] as { target: unknown }).target).toBe(
      schema.users.authUserId,
    );
  });

  it("returns null with no DATABASE_URL, without touching the driver", async () => {
    delete process.env.DATABASE_URL;

    await expect(resolveAccountUser("auth-1", null)).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns null when no row comes back", async () => {
    dbRows = [];

    await expect(resolveAccountUser("auth-1", null)).resolves.toBeNull();
  });

  it("returns null rather than throwing when the driver rejects", async () => {
    dbError = new Error("neon unreachable");

    await expect(resolveAccountUser("auth-1", null)).resolves.toBeNull();
  });
});

// --- The security log -----------------------------------------------------

describe("recordSecurityEvent", () => {
  it("logs the FIRST address of a comma-separated x-forwarded-for, trimmed", async () => {
    // Behind a proxy chain the client is the first hop; taking the last one
    // records our own load balancer against every event in the feed.
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7 , 70.41.3.18, 150.172.238.178",
      "x-real-ip": "10.0.0.1",
      "user-agent": "Mozilla/5.0 (Macintosh)",
    });

    await recordSecurityEvent(headers, "user-uuid", "password_changed");

    expect(insertedPayloads()).toEqual([
      {
        userId: "user-uuid",
        kind: "password_changed",
        ip: "203.0.113.7",
        userAgent: "Mozilla/5.0 (Macintosh)",
      },
    ]);
  });

  it("falls back to x-real-ip when x-forwarded-for is absent or empty", async () => {
    await recordSecurityEvent(
      new Headers({ "x-real-ip": "198.51.100.9" }),
      "user-uuid",
      "session_revoked",
    );
    await recordSecurityEvent(
      new Headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }),
      "user-uuid",
      "session_revoked",
    );

    const ips = insertedPayloads().map((p) => (p as { ip: string | null }).ip);
    expect(ips).toEqual(["198.51.100.9", "198.51.100.9"]);
  });

  it("records null context rather than an empty string when neither header is present", async () => {
    await recordSecurityEvent(
      new Headers(),
      "user-uuid",
      "sessions_revoked_others",
    );

    expect(insertedPayloads()).toEqual([
      {
        userId: "user-uuid",
        kind: "sessions_revoked_others",
        ip: null,
        userAgent: null,
      },
    ]);
  });

  it("resolves when the insert itself rejects", async () => {
    // The change has already happened. Refusing a completed password change
    // because its log line would not write protects nobody.
    dbError = new Error("neon unreachable");

    await expect(
      recordSecurityEvent(new Headers(), "user-uuid", "password_changed"),
    ).resolves.toBeUndefined();
  });
});

describe("listSecurityEvents", () => {
  it("returns the driver's rows and passes the caller's limit through", async () => {
    dbRows = [
      {
        id: "e1",
        kind: "password_changed",
        ip: "203.0.113.7",
        userAgent: "UA",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];

    const events = await listSecurityEvents("user-uuid", 25);

    expect(events).toEqual(dbRows);
    const limit = calls.find((c) => c.method === "limit");
    expect(limit?.args).toEqual([25]);
  });

  it("defaults to 10 when the caller does not say", async () => {
    // An unbounded read on a page that already makes five calls is how a
    // long-lived account's security card becomes the slowest thing on it.
    await listSecurityEvents("user-uuid");

    expect(calls.find((c) => c.method === "limit")?.args).toEqual([10]);
  });

  it("returns [] with no DATABASE_URL, without touching the driver", async () => {
    delete process.env.DATABASE_URL;

    await expect(listSecurityEvents("user-uuid")).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it("returns [] rather than throwing when the driver rejects", async () => {
    dbError = new Error("neon unreachable");

    await expect(listSecurityEvents("user-uuid")).resolves.toEqual([]);
  });
});

// --- Two-factor -----------------------------------------------------------

describe("getTwoFactorEnabled", () => {
  it("is true only for an explicit true, not for any truthy value", async () => {
    dbRows = [{ enabled: true }];
    await expect(getTwoFactorEnabled("auth-1")).resolves.toBe(true);

    // A driver that hands back 1 for a boolean column must not be read as "2FA
    // is on" — this surface tells someone whether their account is protected.
    calls = [];
    dbRows = [{ enabled: 1 }];
    await expect(getTwoFactorEnabled("auth-1")).resolves.toBe(false);
  });

  it("is false when the row is missing, unconfigured, or the driver rejects", async () => {
    dbRows = [];
    await expect(getTwoFactorEnabled("auth-1")).resolves.toBe(false);

    dbError = new Error("neon unreachable");
    await expect(getTwoFactorEnabled("auth-1")).resolves.toBe(false);

    dbError = null;
    calls = [];
    delete process.env.DATABASE_URL;
    await expect(getTwoFactorEnabled("auth-1")).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});

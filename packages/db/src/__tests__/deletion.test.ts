import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb, type FakeDbHandle, type RecordedOp } from "./support/fake-db";

// Both drivers are replaced by the recording fake in ./support/fake-db, so the
// BRANCHES can be driven: which id space is resolved, whether an elapsed grace
// is refused, what happens when the concurrency-guarding UPDATE matches nothing.
//
// What this file cannot prove — and does not claim — is that any of these
// statements is valid SQL against the real schema. That half is `tsc --noEmit`
// (drizzle's builders are typed against schema.ts) and the e2e suite. Audit B1
// was BOTH kinds of failure at once: a predicate on the wrong column, and a
// test that asserted only that the hook was wired.
const mocks = vi.hoisted(() => ({
  createHttpDb: vi.fn(),
  createPooledDb: vi.fn(),
}));
vi.mock("../index", () => ({
  createHttpDb: mocks.createHttpDb,
  createPooledDb: mocks.createPooledDb,
}));

import { cancelPendingDeletion } from "../deletion";

const REAL_DATABASE_URL = process.env.DATABASE_URL;

const AUTH_USER_ID = "better-auth-text-id-abc123";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const REQUEST_ID = "99999999-8888-7777-6666-555555555555";
const EMAIL = "alice@example.com";

const NOW = new Date("2026-08-04T12:00:00.000Z");
/** Requested three days ago, 14-day grace: still cancelable at NOW. */
const PENDING_IN_GRACE = {
  id: REQUEST_ID,
  status: "pending" as const,
  requestedAt: new Date("2026-08-01T12:00:00.000Z"),
  graceEndsAt: new Date("2026-08-15T12:00:00.000Z"),
  cancelledAt: null,
  completedAt: null,
};

interface Wiring {
  http: FakeDbHandle;
  pooled: FakeDbHandle;
  poolEnd: ReturnType<typeof vi.fn>;
}

/**
 * Wire both drivers to fakes.
 *
 * `answers` overrides individual statements by a short label; anything not
 * overridden takes the happy path. Building the scenario as "the happy path,
 * except X" keeps each test's DIFFERENCE from working the only thing on screen.
 */
function wire(answers: Partial<{
  /** users row for the auth-id lookup */
  userLookup: unknown[];
  /** the deletion request itself */
  request: unknown[];
  /** rows the concurrency-guarded UPDATE matched */
  updated: unknown[];
  /** users row for the email lookup */
  emailLookup: unknown[];
  onInsert: (op: RecordedOp) => void;
  onTransaction: () => void;
}> = {}): Wiring {
  const http = createFakeDb((op) => {
    if (op.kind === "insert") {
      answers.onInsert?.(op);
      return [];
    }
    if (op.table === "users") {
      return op.projection.includes("email")
        ? (answers.emailLookup ?? [{ email: EMAIL }])
        : (answers.userLookup ?? [{ id: USER_ID }]);
    }
    if (op.table === "account_deletion_requests") {
      return answers.request ?? [PENDING_IN_GRACE];
    }
    return [];
  });

  const pooled = createFakeDb((op) => {
    if (op.kind === "update") return answers.updated ?? [{ id: REQUEST_ID }];
    return [];
  });
  const wrappedPooled: FakeDbHandle = {
    ...pooled,
    get transactions() {
      return pooled.transactions;
    },
    db: {
      ...(pooled.db as object),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        answers.onTransaction?.();
        return (pooled.db as { transaction(c: typeof cb): Promise<unknown> }).transaction(cb);
      },
    },
  };

  const poolEnd = vi.fn(async () => {});
  mocks.createHttpDb.mockReturnValue(http.db);
  mocks.createPooledDb.mockReturnValue({ db: wrappedPooled.db, pool: { end: poolEnd } });
  return { http, pooled, poolEnd };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
});

afterEach(() => {
  if (REAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = REAL_DATABASE_URL;
  vi.restoreAllMocks();
});

describe("cancelPendingDeletion — resolving the caller's id", () => {
  it("resolves a Better Auth authUserId through users.auth_user_id FIRST", async () => {
    // REGRESSION B1. The first fix passed `session.userId` (Better Auth's TEXT
    // id) straight in as `userId`, so the very next query compared a uuid column
    // to a text value, Postgres refused, the catch swallowed it, and the
    // function answered "nothing to cancel" on EVERY sign-in. It shipped, was
    // believed fixed, and was not — because the test asserted the hook was
    // wired, never that the wiring resolved a row.
    const { http } = wire();
    await cancelPendingDeletion({ authUserId: AUTH_USER_ID, via: "sign_in", now: NOW });

    const first = http.ops[0];
    expect(first?.table).toBe("users");
    expect(first?.where).toEqual([
      { column: "auth_user_id", value: AUTH_USER_ID },
    ]);

    // ...and the resolved uuid — not the auth id — is what the request lookup
    // is keyed on.
    const request = http.opsOn("account_deletion_requests", "select")[0];
    expect(request?.where).toContainEqual({ column: "user_id", value: USER_ID });
    expect(request?.where).not.toContainEqual({
      column: "user_id",
      value: AUTH_USER_ID,
    });
  });

  it("skips the lookup when our own users.id is supplied", async () => {
    const { http } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "explicit", now: NOW });
    expect(http.opsOn("users", "select")).toHaveLength(1); // the email read only
    expect(http.ops[0]?.table).toBe("account_deletion_requests");
  });

  it("returns not-cancelled when the authUserId resolves no row", async () => {
    const { http, pooled } = wire({ userLookup: [] });
    await expect(
      cancelPendingDeletion({ authUserId: "ghost", via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(http.opsOn("account_deletion_requests")).toHaveLength(0);
    expect(pooled.transactions).toBe(0);
  });

  it("returns not-cancelled when neither id is supplied", async () => {
    const { http } = wire();
    await expect(
      cancelPendingDeletion({ via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(http.ops).toHaveLength(0);
  });

  it("writes nothing at all when no DB is configured", async () => {
    // AGENTS.md rule 4. This runs from the session-create hook, so a DB-less
    // boot must reach a graceful no-op rather than a crash.
    delete process.env.DATABASE_URL;
    wire();
    await expect(
      cancelPendingDeletion({ authUserId: AUTH_USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(mocks.createHttpDb).not.toHaveBeenCalled();
  });
});

describe("cancelPendingDeletion — the grace-period decision", () => {
  it("REFUSES a request whose grace has already elapsed, and writes nothing", async () => {
    // A late sign-in must not race the sanitization sweeper into an ambiguous
    // half-deleted state: either the grace rescued you or it did not.
    const { pooled, poolEnd } = wire({
      request: [
        { ...PENDING_IN_GRACE, graceEndsAt: new Date("2026-08-03T12:00:00.000Z") },
      ],
    });
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(pooled.transactions).toBe(0);
    expect(poolEnd).not.toHaveBeenCalled();
  });

  it("no-ops when there is no pending request", async () => {
    const { pooled } = wire({ request: [] });
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(pooled.transactions).toBe(0);
  });

  it("reads only PENDING requests, newest first", async () => {
    // Ordering matters because a burner may have requested, cancelled and
    // requested again; the oldest row is a settled one.
    const { http } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW });
    const read = http.opsOn("account_deletion_requests", "select")[0];
    expect(read?.where).toContainEqual({ column: "status", value: "pending" });
    expect(read?.ordered).toBe(true);
    expect(read?.limit).toBe(1);
  });
});

describe("cancelPendingDeletion — the cancellation itself", () => {
  it("stamps status, cancelledAt and updatedAt from the injected clock", async () => {
    // Not `new Date()`: the caller's `now` is the one the grace decision was
    // made against, and a row stamped with a different instant is a row whose
    // own history disagrees with the decision that produced it.
    const { pooled } = wire();
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "explicit", now: NOW }),
    ).resolves.toEqual({ cancelled: true, email: EMAIL });

    const update = pooled.opsOn("account_deletion_requests", "update")[0];
    expect(update?.set).toEqual({
      status: "cancelled",
      cancelledAt: NOW,
      updatedAt: NOW,
    });
  });

  it("keeps status = 'pending' in the UPDATE's WHERE — that predicate IS the concurrency guard", async () => {
    const { pooled } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW });
    const update = pooled.opsOn("account_deletion_requests", "update")[0];
    expect(update?.where).toContainEqual({ column: "id", value: REQUEST_ID });
    expect(update?.where).toContainEqual({ column: "status", value: "pending" });
    expect(update?.returning).toBe(true);
  });

  it("writes NO audit row and reports not-cancelled when the guarded UPDATE matches nothing", async () => {
    // Two simultaneous sign-ins: the loser's UPDATE finds no `pending` row. It
    // must not double-cancel, and it must not file a second audit event
    // claiming a cancellation it did not perform.
    const { pooled } = wire({ updated: [] });
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(pooled.opsOn("audit_events")).toHaveLength(0);
  });

  it("files the audit row INSIDE the same transaction, tagged with how it was triggered", async () => {
    // A cancelled deletion must never exist without the record of it, and an
    // audit line must never claim a cancel that did not persist. Same
    // transaction is what makes both true.
    const { pooled } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW });
    const audit = pooled.opsOn("audit_events", "insert")[0];
    expect(audit?.inTransaction).toBe(true);
    expect(pooled.opsOn("account_deletion_requests", "update")[0]?.inTransaction).toBe(true);
    expect(audit?.values[0]).toMatchObject({
      actorId: USER_ID,
      subject: USER_ID,
      action: "account.deletion_cancelled",
      meta: { via: "sign_in" },
    });
  });

  it("records 'explicit' when the Cancel button triggered it", async () => {
    const { pooled } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "explicit", now: NOW });
    expect(pooled.opsOn("audit_events", "insert")[0]?.values[0]).toMatchObject({
      meta: { via: "explicit" },
    });
  });

  it("ends the pool even when the transaction throws", async () => {
    // A leaked pool holds a Neon connection open for the life of the lambda.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { poolEnd } = wire({
      onTransaction: () => {
        throw new Error("deadlock detected");
      },
    });
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(poolEnd).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalled();
  });
});

describe("cancelPendingDeletion — the courtesy rows", () => {
  it("stamps the inbox row origin 'system' and linkApp 'web'", async () => {
    // DOCUMENTED INCIDENT. The payload's link is `/account`, which exists ONLY
    // in apps/web — the console has `/accounts` (a different screen) and the
    // supplier portal has neither. This runs from the session-create hook in
    // ALL THREE apps, so an org staffer or supplier who cancelled by coming
    // back got an inbox row that rendered as a link and 404'd on click. A null
    // link_app means "treat as local wherever it is read", which is the bug.
    const { http } = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW });
    const row = http.opsOn("notifications", "insert")[0]?.values[0];
    expect(row).toMatchObject({ userId: USER_ID, origin: "system", linkApp: "web" });
    expect(row?.link).toBe("/account");
  });

  it("carries the caller's ip and userAgent onto the security event, and nulls without context", async () => {
    const withContext = wire();
    await cancelPendingDeletion({
      userId: USER_ID,
      via: "sign_in",
      now: NOW,
      context: { ip: "198.51.100.7", userAgent: "Firefox/141.0" },
    });
    expect(withContext.http.opsOn("security_events", "insert")[0]?.values[0]).toMatchObject({
      kind: "deletion_cancelled",
      ip: "198.51.100.7",
      userAgent: "Firefox/141.0",
    });

    const withoutContext = wire();
    await cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW });
    expect(withoutContext.http.opsOn("security_events", "insert")[0]?.values[0]).toMatchObject({
      ip: null,
      userAgent: null,
    });
  });

  it("still reports cancelled when the notification or security-event insert throws", async () => {
    // The cancellation has already COMMITTED. Undoing it — or reporting it as a
    // failure, which sends the burner back to a screen saying they are still
    // being deleted — over a courtesy row would be the real damage.
    for (const failing of ["notifications", "security_events"]) {
      const { http } = wire({
        onInsert: (op) => {
          if (op.table === failing) throw new Error(`${failing} write failed`);
        },
      });
      await expect(
        cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
      ).resolves.toEqual({ cancelled: true, email: EMAIL });
      expect(http.opsOn(failing, "insert")).toHaveLength(1);
    }
  });

  it("returns cancelled with a null email when the account row has since gone", async () => {
    const { poolEnd } = wire({ emailLookup: [] });
    await expect(
      cancelPendingDeletion({ userId: USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: true, email: null });
    expect(poolEnd).toHaveBeenCalledOnce();
  });
});

describe("cancelPendingDeletion — never breaks a sign-in", () => {
  it("swallows and logs any throw rather than propagating it", async () => {
    // This runs inside the Better Auth session-create hook. A throw here would
    // turn a database hiccup into "you cannot sign in".
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createHttpDb.mockImplementation(() => {
      throw new Error("neon: connection refused");
    });
    await expect(
      cancelPendingDeletion({ authUserId: AUTH_USER_ID, via: "sign_in", now: NOW }),
    ).resolves.toEqual({ cancelled: false, email: null });
    expect(String(logged.mock.calls[0]?.[0])).toContain("[deletion]");
  });
});

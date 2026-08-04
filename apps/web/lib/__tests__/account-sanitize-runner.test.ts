import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import {
  SANITIZED_BIO_NULL_FIELDS,
  patchLeaksAny,
  uncoveredHardLockedFields,
} from "@quagga/core";
import { boundStrings, dbMock } from "@/test/db-mock";

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);

const stubs = vi.hoisted(() => ({
  guard: {
    ledProjects: [] as unknown[],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 0,
  },
  /** Every argument `buildDeletionGuardContext` was called with. */
  guardCalls: [] as string[],
  sent: [] as { to: string | string[] }[],
  delivered: true,
}));

vi.mock("@/lib/account", () => ({
  buildDeletionGuardContext: async (userId: string) => {
    stubs.guardCalls.push(userId);
    return stubs.guard;
  },
}));

vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: async (input: { to: string | string[] }) => {
    stubs.sent.push(input);
    return { ok: true, id: "mail-1", delivered: stubs.delivered };
  },
}));

const { sanitizeAccount, sweepDueDeletions } =
  await import("../account-sanitize");

const USER = "cccccccc-0000-0000-0000-000000000001";
const AUTH_ID = "auth-0000-0000-0000-000000000001";
const REQUEST = "req-0000-0000-0000-000000000001";
const NOW = new Date("2026-08-20T12:00:00Z");

/** A deletion request whose grace period elapsed a week ago. */
function dueRequest(overrides: Record<string, unknown> = {}) {
  return {
    status: "pending",
    requestedAt: new Date("2026-08-01T00:00:00Z"),
    graceEndsAt: new Date("2026-08-15T00:00:00Z"),
    cancelledAt: null,
    completedAt: null,
    ...overrides,
  };
}

/**
 * Everything `sanitizeAccount` reads and writes after the eligibility re-check,
 * in order. The transaction's writes each consume a queued value too, so the
 * defaults (an empty array) stand in for "nothing was released".
 */
function queueErasure(
  input: {
    user?: { email: string | null; authUserId: string } | null;
    memberships?: number;
    bios?: number;
    releasedSuppliers?: unknown[];
    vacatedWranglers?: unknown[];
    orgMemberships?: unknown[];
    revokedOrgRoles?: unknown[];
  } = {},
) {
  const user =
    input.user === undefined
      ? { email: "alice@example.com", authUserId: AUTH_ID }
      : input.user;
  dbMock.queue(user ? [{ ...user, sanitizedAt: null }] : []);
  if (!user) return;
  dbMock.queue(
    [{ memberships: input.memberships ?? 3 }],
    [{ bios: input.bios ?? 1 }],
    /* delete profileKeys */ [],
    /* delete emailChangeRequests */ [],
    /* delete securityEvents */ [],
    /* update burnerBios */ [],
    /* delete session */ [],
    /* delete account */ [],
    /* delete user */ [],
    /* update users (the tombstone) */ [],
    /* update the request */ [],
    /* released suppliers … returning */ input.releasedSuppliers ?? [],
    /* vacated wranglers … returning */ input.vacatedWranglers ?? [],
    /* the org memberships */ input.orgMemberships ?? [],
  );
  if ((input.orgMemberships ?? []).length > 0) {
    dbMock.queue(
      /* revoked org role assignments … returning */
      input.revokedOrgRoles ?? [],
      /* demote the org membership */ [],
    );
  }
  dbMock.queue(/* the audit_events meta scrub */ []);
  const released =
    (input.releasedSuppliers ?? []).length > 0 ||
    (input.vacatedWranglers ?? []).length > 0 ||
    (input.revokedOrgRoles ?? []).length > 0;
  if (released) dbMock.queue(/* the released-holdings audit row */ []);
  dbMock.queue(/* the sanitization audit row */ []);
}

beforeEach(() => {
  dbMock.reset();
  stubs.guard = {
    ledProjects: [],
    isOrgGod: false,
    orgGodCount: 0,
    signInMethodCount: 0,
  };
  stubs.guardCalls = [];
  stubs.sent = [];
  stubs.delivered = true;
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sanitizeAccount — what must NOT be erased", () => {
  it("refuses when the database is not configured, without querying", async () => {
    vi.stubEnv("DATABASE_URL", "");

    expect(await sanitizeAccount(USER, REQUEST, NOW)).toMatchObject({
      ok: false,
      error: "Database is not configured.",
    });
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a missing request and a missing user with their own errors", async () => {
    dbMock.queue(/* no request */ []);
    expect(await sanitizeAccount(USER, REQUEST, NOW)).toMatchObject({
      ok: false,
      error: "Deletion request not found.",
    });

    dbMock.reset();
    dbMock.queue([dueRequest()]);
    queueErasure({ user: null });
    expect(await sanitizeAccount(USER, REQUEST, NOW)).toMatchObject({
      ok: false,
      error: "Account not found.",
    });
    expect(dbMock.transactions).toBe(0);
  });

  it("ERASES NOTHING for a cancelled, completed or still-in-grace request", async () => {
    // Whatever the caller believed when it queued the work, the request is
    // re-checked here — this is the last point at which anything is reversible.
    const cases = [
      dueRequest({ status: "cancelled", cancelledAt: new Date("2026-08-02") }),
      dueRequest({ status: "completed", completedAt: new Date("2026-08-16") }),
      dueRequest({ graceEndsAt: new Date("2026-09-01T00:00:00Z") }),
    ];

    for (const request of cases) {
      dbMock.reset();
      dbMock.queue([request]);
      const result = await sanitizeAccount(USER, REQUEST, NOW);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/isn't due/);
      expect(dbMock.transactions).toBe(0);
      // Not one erasing write was issued.
      expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
      expect(dbMock.queriesOfKind("update")).toHaveLength(0);
    }
  });

  it("LEAVES THE REQUEST PENDING when the anti-lockout guard still blocks", async () => {
    // Two System managers can both pass the create-time check and both be
    // erased on day 14, leaving zero live gods and no screen that can grant one
    // back. Only a check HERE closes it, because only here is the outcome final.
    //
    // A caught account is left pending — not failed, not force-deleted: the
    // grace period has already elapsed, so the next sweep retries the moment
    // somebody else is granted god.
    stubs.guard = {
      ledProjects: [],
      isOrgGod: true,
      orgGodCount: 1,
      signInMethodCount: 0,
    };
    dbMock.queue([dueRequest()]);

    const result = await sanitizeAccount(USER, REQUEST, NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Still blocked at sanitization time/);
    expect(dbMock.transactions).toBe(0);
    expect(dbMock.queriesOfKind("delete")).toHaveLength(0);
  });

  it("re-checks with signInMethodCount forced to 1, so a revoked social link cannot strand it", async () => {
    // The sign-in-method guard exists so nobody deletes an account they can no
    // longer prove is theirs — and they already proved it when they asked.
    // Re-applying it here would strand every request whose last social link was
    // revoked in the meantime. `stubs.guard` reports 0 methods, and this still
    // proceeds.
    dbMock.queue([dueRequest()]);
    queueErasure();

    expect(await sanitizeAccount(USER, REQUEST, NOW)).toMatchObject({
      ok: true,
    });
    expect(stubs.guardCalls).toEqual([USER]);
  });
});

describe("sanitizeAccount — the erasure itself", () => {
  // WHY THESE TWO PAYLOAD TESTS EXIST, ahead of the ordering one below.
  //
  // Every other assertion in this file is about the SHAPE of the transaction —
  // which table, in which position, inside how many transactions. All of that
  // stayed green when `.set(plan.bio)` was replaced with `.set({})`: an erasure
  // that erases nothing, leaving a "deleted" account's phone, both emergency
  // contacts, medical notes and ID numbers sitting on the row, with the
  // tombstone stamped over them and the farewell email telling the person their
  // details are gone. The write still happened, to the right table, in the right
  // order, and `bioRows: 1` still came back. That is the whole failure: a file
  // held at a per-file coverage floor of 98/98/100/94 while the one thing the
  // module exists to do was unasserted.
  //
  // So the payload is asserted, not merely the write. @quagga/core proves the
  // PLAN covers every always-private column; these prove the app hands that plan
  // to the database rather than something else.

  it("NULLS every always-private bio column — the erasure, not just the write", async () => {
    dbMock.queue([dueRequest()]);
    queueErasure();

    await sanitizeAccount(USER, REQUEST, NOW);

    const patch = dbMock.writesTo(schema.burnerBios)[0]!.arg("set") as Record<
      string,
      unknown
    >;

    // Named one at a time, because these are the columns whose survival IS the
    // POPIA failure: the hard-locked class (phone, both emergency contacts, SA
    // ID, passport — no reveal path of any kind) and the safety-visible class
    // (medical notes). AGENTS.md §Privacy classes.
    expect(patch.phone).toBeNull();
    expect(patch.onsiteContactPhone).toBeNull();
    expect(patch.offsiteContactPhone).toBeNull();
    expect(patch.medicalNotes).toBeNull();
    expect(patch.saIdEncrypted).toBeNull();
    expect(patch.passportEncrypted).toBeNull();

    // The same completeness check @quagga/core runs against the plan, run here
    // against what was actually handed to the database — so a future privacy
    // class added to core/privacy.ts and forgotten on THIS path fails here too.
    expect(uncoveredHardLockedFields(patch)).toEqual([]);
    for (const column of SANITIZED_BIO_NULL_FIELDS) {
      expect(patch[column]).toBeNull();
    }

    // The re-identifying arrays and flags are reset rather than left standing —
    // a stub carrying someone's skills, years and camp history is not erased.
    expect(patch.skills).toEqual([]);
    expect(patch.attendedYears).toEqual([]);
    expect(patch.privacyFlags).toEqual({});
    expect(patch.updatedAt).toBeInstanceOf(Date);
  });

  it("nulls the email and username on the users row it keeps", async () => {
    // The `users` row survives on purpose (memberships, responses and the audit
    // trail point at it), so what is LEFT on it is the erasure. Email and
    // username are the two identifying columns it holds, and the row is queried
    // by the account search — a tombstone that kept either would be a deleted
    // account still findable by name.
    dbMock.queue([dueRequest()]);
    queueErasure();

    await sanitizeAccount(USER, REQUEST, NOW);

    const tombstone = dbMock
      .writesTo(schema.users)
      .find((q) => q.kind === "update")!;
    const patch = tombstone.arg("set") as Record<string, unknown>;
    expect(patch.email).toBeNull();
    expect(patch.username).toBeNull();
    expect(patch.sanitizedAt).toBeInstanceOf(Date);
    // Nothing personal survives in the patch itself either — including the
    // address the farewell mail is about to be sent to.
    expect(patchLeaksAny(patch, ["alice@example.com"])).toBe(false);
    expect(boundStrings(tombstone)).not.toContain("alice@example.com");
  });

  it("writes in order: secrets, bios, identity, then the tombstone LAST", async () => {
    dbMock.queue([dueRequest()]);
    queueErasure();

    expect(await sanitizeAccount(USER, REQUEST, NOW)).toMatchObject({
      ok: true,
      bioRows: 1,
      membershipsPreserved: 3,
    });

    const order = dbMock.queries
      .filter((q) => q.tx)
      .map((q) => `${q.kind}:${tableName(q.calls[0]!.args[0])}`);

    // The identity hard-delete: sessions (every cookie), then the
    // credential/OAuth rows (the password hash), then the user row (email PII).
    expect(order).toContain("delete:session");
    expect(order).toContain("delete:account");
    expect(order).toContain("delete:user");
    expect(order.indexOf("delete:session")).toBeLessThan(
      order.indexOf("delete:account"),
    );
    expect(order.indexOf("delete:account")).toBeLessThan(
      order.indexOf("delete:user"),
    );

    // The tombstone only ever marks an erasure that has actually happened.
    expect(order.indexOf("delete:user")).toBeLessThan(
      order.indexOf("update:users"),
    );
    // Secrets first — nothing references those rows.
    expect(order.indexOf("delete:profile_keys")).toBeLessThan(
      order.indexOf("update:burner_bios"),
    );

    // And the whole thing is ONE transaction, so a partial POPIA erasure is
    // impossible.
    expect(dbMock.transactions).toBe(1);
  });

  it("PRESERVES memberships, responses and audit rows — the cascade would be the damage", async () => {
    dbMock.queue([dueRequest()]);
    queueErasure();

    await sanitizeAccount(USER, REQUEST, NOW);

    expect(
      dbMock.queriesOfKind("delete").map((q) => tableName(q.calls[0]!.args[0])),
    ).not.toContain("memberships");
    expect(
      dbMock.queriesOfKind("delete").map((q) => tableName(q.calls[0]!.args[0])),
    ).not.toContain("required_actions");
  });

  it("leaves auth_user_id alone so the tombstone stays findable", async () => {
    // The session resolver looks the row up by `auth_user_id`; changing it here
    // would let the resolver mint a fresh account instead of refusing — the
    // re-animation hole.
    dbMock.queue([dueRequest()]);
    queueErasure();

    await sanitizeAccount(USER, REQUEST, NOW);

    const tombstone = dbMock
      .writesTo(schema.users)
      .find((q) => q.kind === "update")!;
    const patch = tombstone.arg("set") as Record<string, unknown>;
    expect(patch).not.toHaveProperty("authUserId");
    expect(patch.sanitizedAt).toBeInstanceOf(Date);
  });

  it("RELEASES a claimed supplier and VACATES a wrangler assignment", async () => {
    // Both foreign keys are `ON DELETE SET NULL` so that losing a person leaves
    // the thing VACANT rather than broken — and neither could ever fire,
    // because keeping the `users` row is the whole design.
    dbMock.queue([dueRequest()]);
    queueErasure({
      releasedSuppliers: [{ id: "sup-1" }],
      vacatedWranglers: [{ groupId: "g-1" }],
    });

    await sanitizeAccount(USER, REQUEST, NOW);

    expect(dbMock.writesTo(schema.suppliers)[0]!.arg("set")).toMatchObject({
      userId: null,
    });
    expect(
      dbMock.writesTo(schema.wranglerAssignments)[0]!.arg("set"),
    ).toMatchObject({ wranglerUserId: null });

    // Recorded, ids only — a System manager asking "who held what before they
    // left?" deserves an answer, and recording it must not undo the erasure.
    const released = dbMock
      .writesTo(schema.auditEvents)
      .map((q) => q.arg("values") as { action: string; meta: unknown })
      .find((v) => v.action === "account.released_holdings")!;
    expect(released.meta).toEqual({
      orgRoleIds: [],
      supplierIds: ["sup-1"],
      wranglerGroupIds: ["g-1"],
      reason: "account sanitization",
    });
    expect(JSON.stringify(released.meta)).not.toContain("@");
  });

  it("REVOKES org role assignments and DEMOTES the org membership to member", async () => {
    // A live console-access grant pointing at a dead account, which the console
    // could not even find: `searchAccounts` matches email and username, both
    // NULL on a tombstone.
    dbMock.queue([dueRequest()]);
    queueErasure({
      orgMemberships: [{ id: "ms-org" }],
      revokedOrgRoles: [{ orgRoleId: "role-1" }],
    });

    await sanitizeAccount(USER, REQUEST, NOW);

    // The membership row STAYS — like every other membership, the history is
    // the point — demoted to the rank that grants nothing.
    const demotion = dbMock
      .writesTo(schema.memberships)
      .find((q) => q.kind === "update")!;
    expect(demotion.arg("set")).toEqual({ role: "member" });
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(1);

    expect(dbMock.writesTo(schema.orgRoleAssignments)[0]!.kind).toBe("delete");
  });

  it("writes NO released-holdings row when nothing was actually released", async () => {
    dbMock.queue([dueRequest()]);
    queueErasure();

    await sanitizeAccount(USER, REQUEST, NOW);

    const actions = dbMock
      .writesTo(schema.auditEvents)
      .map((q) => (q.arg("values") as { action: string }).action);
    expect(actions).not.toContain("account.released_holdings");
    // The proof-of-erasure row is still written.
    expect(actions).toHaveLength(1);
  });

  it("mails the farewell only when an address was captured, and reports delivery honestly", async () => {
    dbMock.queue([dueRequest()]);
    queueErasure();
    stubs.delivered = false;

    const undelivered = await sanitizeAccount(USER, REQUEST, NOW);
    // The last message this address will ever get from us — and `notified`
    // says whether it went, not whether we tried.
    expect(stubs.sent.map((m) => m.to)).toEqual(["alice@example.com"]);
    expect(undelivered.notified).toBe(false);

    dbMock.reset();
    stubs.sent = [];
    stubs.delivered = true;
    dbMock.queue([dueRequest()]);
    queueErasure({ user: { email: null, authUserId: AUTH_ID } });

    const noAddress = await sanitizeAccount(USER, REQUEST, NOW);
    expect(noAddress.ok).toBe(true);
    expect(stubs.sent).toHaveLength(0);
    expect(noAddress.notified).toBe(false);
  });
});

describe("sweepDueDeletions", () => {
  it("returns an empty list when the database is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await sweepDueDeletions(NOW)).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("does not abort the sweep when one account's sanitization throws", async () => {
    // A backlog of one broken row must not stop everybody else's erasure.
    dbMock.queue([
      { id: "req-1", userId: "user-1" },
      { id: "req-2", userId: "user-2" },
    ]);
    // user-1: the request read throws.
    dbMock.queue(new Error("connection terminated unexpectedly"));
    // user-2: an ordinary refusal, which is a RESULT rather than a throw.
    dbMock.queue([]);

    const results = await sweepDueDeletions(NOW);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ok: false,
      userId: "user-1",
      error: "connection terminated unexpectedly",
    });
    expect(results[1]).toMatchObject({
      ok: false,
      userId: "user-2",
      error: "Deletion request not found.",
    });
  });

  it("returns an empty list when nothing is due", async () => {
    dbMock.queue([]);
    expect(await sweepDueDeletions(NOW)).toEqual([]);
  });
});

/** The SQL name of a drizzle table, for order assertions. */
function tableName(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table as object);
  for (const symbol of symbols) {
    if (String(symbol).includes("Name")) {
      const value = (table as Record<symbol, unknown>)[symbol];
      if (typeof value === "string") return value;
    }
  }
  return "unknown";
}

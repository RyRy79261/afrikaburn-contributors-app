import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { BURNER_BIO_ACTION_KEY } from "@quagga/core";
import { dbMock } from "@/test/db-mock";
import { authMock } from "@/test/auth-mock";
import { redirectTarget, resetNextMocks } from "@/test/next-mocks";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("next/headers", async () =>
  (await import("@/test/next-mocks")).nextHeadersMock(),
);
vi.mock("@quagga/auth", async () =>
  (await import("@/test/auth-mock")).authModuleMock(),
);

const {
  ensureCampUser,
  getCurrentCampUser,
  requireCampUser,
  pendingBlockingRoute,
  enforceGate,
  viewerIsGated,
  getOrgGroup,
} = await import("../session");

const AUTH_ID = "auth-0000-0000-0000-000000000001";
const USER_ID = "cccccccc-0000-0000-0000-000000000001";
const ORG_ID = "0f9a0000-0000-0000-0000-00000000000a";
const MEMBERSHIP_ID = "mmmmmmmm-0000-0000-0000-000000000001";
const EDITION_ID = "eeeeeeee-0000-0000-0000-000000000000";
const GOD_EMAIL = "ryan@example.com";

const authUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: AUTH_ID,
  primaryEmail: GOD_EMAIL,
  displayName: "Ryan",
  emailVerified: true,
  ...overrides,
});

/** The `users` row the second query returns. `sanitizedAt` absent = live. */
const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: USER_ID,
  authUserId: AUTH_ID,
  email: GOD_EMAIL,
  username: null,
  sanitizedAt: null,
  ...overrides,
});

/** The active-edition pair `getActiveEdition` consumes: the flagged row, or an
 * empty result plus the most-recent fallback. */
function queueEdition(edition: { id: string } | null) {
  if (edition) dbMock.queue([edition]);
  else dbMock.queue([], []);
}

beforeEach(() => {
  dbMock.reset();
  authMock.reset();
  resetNextMocks();
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("GOD_EMAILS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ensureCampUser — the re-animation guard", () => {
  it("REFUSES a sanitized account, and bootstraps nothing for it", async () => {
    // A deleted-and-sanitized account keeps its `users` row on purpose
    // (memberships, roles and audit history survive for integrity), so handing
    // it back a session would silently re-adopt a stranger's — possibly a camp
    // lead's — permissions and un-erase the account. The Better Auth identity
    // is already gone, so no fresh sign-in reaches here; the cookie cache
    // serving a stale session for up to its 5-minute maxAge is what does.
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue([], [userRow({ sanitizedAt: new Date("2026-07-01") })]);

    expect(await ensureCampUser(authUser())).toBeNull();

    // Refused BEFORE the god bootstrap and before the required-action write —
    // both of which would have re-animated something.
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("returns null without touching the database when it is not configured", async () => {
    // Env-less boot is a hard constraint: every DB-backed surface renders a
    // graceful "not configured" state rather than throwing.
    vi.stubEnv("DATABASE_URL", "");

    expect(await ensureCampUser(authUser())).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });

  it("returns null when the upserted row cannot be read back", async () => {
    dbMock.queue([], []);
    expect(await ensureCampUser(authUser())).toBeNull();
  });
});

describe("ensureCampUser — keeping the email fresh", () => {
  it("writes the new primary email when the stored one has gone stale", async () => {
    dbMock.queue([], [userRow({ email: "old@example.com" })]);
    queueEdition(null);

    const campUser = await ensureCampUser(authUser());

    const update = dbMock
      .writesTo(schema.users)
      .find((q) => q.kind === "update");
    expect(update?.arg("set")).toEqual({ email: GOD_EMAIL });
    // …and the value the caller gets back is the fresh one, not the row's.
    expect(campUser?.email).toBe(GOD_EMAIL);
  });

  it("issues no write when the stored email already matches", async () => {
    dbMock.queue([], [userRow()]);
    queueEdition(null);

    await ensureCampUser(authUser());

    expect(
      dbMock.writesTo(schema.users).filter((q) => q.kind === "update"),
    ).toHaveLength(0);
  });
});

describe("bootstrapGod — the GOD_EMAILS elevation", () => {
  it("grants nothing when the email is UNVERIFIED, listed or not", async () => {
    // The listing is not the proof. Anyone who can receive at a listed address
    // would otherwise get the org's highest role by signing up with it.
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue([], [userRow()]);
    queueEdition(null);

    await ensureCampUser(authUser({ emailVerified: false }));

    expect(dbMock.queriesTouching(schema.groups)).toHaveLength(0);
    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
  });

  it("grants nothing when the org group is not seeded", async () => {
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue([], [userRow()], /* org group */ []);
    queueEdition(null);

    await ensureCampUser(authUser());

    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
  });

  it("mints the god membership and audits it exactly once", async () => {
    vi.stubEnv("GOD_EMAILS", `someone-else@example.com, ${GOD_EMAIL}`);
    dbMock.queue(
      [],
      [userRow()],
      [{ id: ORG_ID }],
      /* existing membership */ [],
      /* insert … returning */ [{ id: MEMBERSHIP_ID }],
      /* the audit insert */ [],
    );
    queueEdition(null);

    await ensureCampUser(authUser());

    const membership = dbMock.writesTo(schema.memberships);
    expect(membership).toHaveLength(1);
    expect(membership[0]!.arg("values")).toEqual({
      userId: USER_ID,
      groupId: ORG_ID,
      role: "god",
    });

    const audit = dbMock.writesTo(schema.auditEvents);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.arg("values")).toMatchObject({
      actorId: USER_ID,
      subject: USER_ID,
      action: "account.elevate",
      meta: { role: "god", via: "god_emails" },
    });
  });

  it("audits NOTHING when the insert hit a conflict and created no row", async () => {
    // `onConflictDoNothing` returns an empty array on a race. Auditing an
    // elevation that did not happen puts an event in the trail that never
    // occurred — and this path runs on every single authenticated request.
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue([], [userRow()], [{ id: ORG_ID }], [], /* returning */ []);
    queueEdition(null);

    await ensureCampUser(authUser());

    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("promotes an existing non-god membership and audits the change", async () => {
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue(
      [],
      [userRow()],
      [{ id: ORG_ID }],
      [{ id: MEMBERSHIP_ID, role: "org_staff" }],
    );
    queueEdition(null);

    await ensureCampUser(authUser());

    const update = dbMock
      .writesTo(schema.memberships)
      .find((q) => q.kind === "update");
    expect(update?.arg("set")).toEqual({ role: "god" });
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(1);
  });

  it("leaves an existing god membership alone and writes no second audit row", async () => {
    // Idempotence matters here because this runs on every authenticated
    // request: an audit row per page view would bury the one elevation that
    // actually happened.
    vi.stubEnv("GOD_EMAILS", GOD_EMAIL);
    dbMock.queue(
      [],
      [userRow()],
      [{ id: ORG_ID }],
      [{ id: MEMBERSHIP_ID, role: "god" }],
    );
    queueEdition(null);

    await ensureCampUser(authUser());

    expect(dbMock.writesTo(schema.memberships)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });
});

describe("ensureCampUser — the per-edition Burner Bio action", () => {
  it("raises the blocking bio action against the edition now running", async () => {
    // Per edition (migration 0024): the bio persists but is CONFIRMED once per
    // burn, so this must key on the CURRENT edition rather than finding last
    // year's completed row and staying silent.
    dbMock.queue([], [userRow()]);
    queueEdition({ id: EDITION_ID });

    await ensureCampUser(authUser());

    const action = dbMock.writesTo(schema.requiredActions);
    expect(action).toHaveLength(1);
    expect(action[0]!.arg("values")).toMatchObject({
      userId: USER_ID,
      editionId: EDITION_ID,
      actionKey: BURNER_BIO_ACTION_KEY,
      blocking: true,
      status: "pending",
    });
  });

  it("raises nothing when no edition is active", async () => {
    dbMock.queue([], [userRow()]);
    queueEdition(null);

    await ensureCampUser(authUser());

    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
  });
});

describe("getOrgGroup", () => {
  it("is null when the org group has not been seeded", async () => {
    dbMock.queue([]);
    expect(await getOrgGroup()).toBeNull();
  });
});

describe("getCurrentCampUser / requireCampUser", () => {
  it("is null when signed out, and never queries", async () => {
    expect(await getCurrentCampUser()).toBeNull();
    expect(dbMock.queries).toHaveLength(0);
  });

  it("swallows a thrown query rather than 500ing a signed-in page", async () => {
    authMock.signedInAs({ id: AUTH_ID, email: GOD_EMAIL, emailVerified: true });
    dbMock.queue(new Error("connection terminated unexpectedly"));

    expect(await getCurrentCampUser()).toBeNull();
  });

  it("requireCampUser redirects a signed-out visitor to sign-in", async () => {
    expect(await redirectTarget(requireCampUser())).toBe("/auth/sign-in");
  });

  it("requireCampUser redirects when the camp user cannot be resolved", async () => {
    // A sanitized account lands here: authenticated by the cookie cache, but
    // refused a camp user. It must go to sign-in, not render as somebody.
    authMock.signedInAs({ id: AUTH_ID, email: GOD_EMAIL, emailVerified: true });
    dbMock.queue([], [userRow({ sanitizedAt: new Date("2026-07-01") })]);

    expect(await redirectTarget(requireCampUser())).toBe("/auth/sign-in");
  });
});

describe("pendingBlockingRoute — the hard-gate spine", () => {
  /** `listRequiredActions` resolves the active edition, then reads the rows. */
  function queueActions(rows: unknown[]) {
    dbMock.queue([{ id: EDITION_ID }], rows);
  }

  it("routes a questionnaire activation key to its fill page", async () => {
    queueActions([
      {
        actionKey: "questionnaire:abc-123",
        blocking: true,
        status: "pending",
        audience: "camps",
        activationStatus: "open",
      },
    ]);

    expect(await pendingBlockingRoute(USER_ID)).toBe("/questionnaires/abc-123");
  });

  it("falls back to /onboarding for a key with no page built for it", async () => {
    // A blocking action nobody can satisfy is worse than a wrong-ish route:
    // the app would gate with nowhere to send them.
    queueActions([
      {
        actionKey: "acknowledgement:leave-no-trace",
        blocking: true,
        status: "pending",
        audience: null,
        activationStatus: null,
      },
    ]);

    expect(await pendingBlockingRoute(USER_ID)).toBe("/onboarding");
  });

  it("is null when nothing blocks", async () => {
    queueActions([
      {
        actionKey: BURNER_BIO_ACTION_KEY,
        blocking: true,
        status: "completed",
        audience: null,
        activationStatus: null,
      },
    ]);

    expect(await pendingBlockingRoute(USER_ID)).toBeNull();
  });
});

describe("enforceGate", () => {
  function queueActions(rows: unknown[]) {
    dbMock.queue([{ id: EDITION_ID }], rows);
  }

  const blockingBio = [
    {
      actionKey: BURNER_BIO_ACTION_KEY,
      blocking: true,
      status: "pending",
      audience: null,
      activationStatus: null,
    },
  ];

  it("does NOT redirect when the caller is already on the blocking route", async () => {
    // Without this the fill page redirects to itself for ever and the burner
    // can never clear the gate.
    queueActions(blockingBio);

    await expect(enforceGate(USER_ID, "/onboarding")).resolves.toBeUndefined();
  });

  it("redirects a blocked user who is somewhere else", async () => {
    queueActions(blockingBio);

    expect(await redirectTarget(enforceGate(USER_ID, "/directory"))).toBe(
      "/onboarding",
    );
  });

  it("does nothing at all when nothing blocks", async () => {
    queueActions([]);

    await expect(enforceGate(USER_ID)).resolves.toBeUndefined();
  });
});

describe("viewerIsGated", () => {
  it("is false for a signed-out visitor — chrome must still render", async () => {
    expect(await viewerIsGated()).toBe(false);
  });

  it("is true for a signed-in user with a pending blocking action", async () => {
    authMock.signedInAs({ id: AUTH_ID, email: GOD_EMAIL, emailVerified: true });
    dbMock.queue([], [userRow()]);
    queueEdition({ id: EDITION_ID });
    dbMock.queue(
      /* ensureRequiredAction insert */ [],
      /* getActiveEdition, again */ [{ id: EDITION_ID }],
      [
        {
          actionKey: BURNER_BIO_ACTION_KEY,
          blocking: true,
          status: "pending",
          audience: null,
          activationStatus: null,
        },
      ],
    );

    expect(await viewerIsGated()).toBe(true);
  });
});

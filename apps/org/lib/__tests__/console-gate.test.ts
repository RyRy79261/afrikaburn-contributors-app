import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE DOOR. Every console page and every server action resolves through
 * `resolveOrgSession`, and this file executes the branches — the re-animation
 * guard, the GOD_EMAILS bootstrap, the rank gate, the two `require*` refusals
 * and the page-level `guardConsole` — rather than asserting that the source
 * text still contains them. `org-role-lockout.test.ts` does the latter
 * deliberately and stays; this is the half that would notice a refactor which
 * kept the words and changed the object.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

// The real read is better-auth's `auth.api.getSession` against a live session
// store plus `next/headers`, neither of which exists here. What this file is
// about starts one line later.
const getAuthenticatedUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: () => getAuthenticatedUser(),
}));

import {
  canManageAccounts,
  requireOrgSession,
  requireSystemManager,
  resolveOrgSession,
} from "@/lib/session";
import { guardConsole } from "@/lib/gate";
import { canBootstrapGodEmail, isGodEmail } from "@/lib/god";
import { reportViewer } from "@/lib/report-viewer";

const ENV = { ...process.env };

const USER = {
  id: "auth-1",
  primaryEmail: "alice@example.com",
  displayName: "Alice Hatter",
  emailVerified: true,
};

/** The rows a signed-in staff member's session resolves through, in table order. */
function seedSession(options: {
  dbUser?: Record<string, unknown> | null;
  membershipRole?: string | null;
  roles?: Record<string, unknown>[];
  domains?: Record<string, unknown>[];
  email?: string | null;
}) {
  const {
    dbUser = { id: "user-1", email: USER.primaryEmail, sanitizedAt: null },
    membershipRole = "org_staff",
    roles = [],
    domains = [],
  } = options;
  db.seed("users", dbUser ? [dbUser] : []);
  db.seed("groups", [{ id: "org-group-1" }]);
  db.seed(
    "memberships",
    membershipRole ? [{ id: "mem-1", role: membershipRole }] : [],
  );
  db.seed("org_role_assignments", roles);
  db.seed("org_department_domains", domains);
}

beforeEach(() => {
  db = fakeDb();
  getAuthenticatedUser.mockReset();
  getAuthenticatedUser.mockResolvedValue(USER);
  process.env.DATABASE_URL = "postgres://localhost/quagga";
  delete process.env.GOD_EMAILS;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("resolveOrgSession — the states the gate can be in", () => {
  it("is unauthenticated when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    await expect(resolveOrgSession()).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("is not_ready — never a crash — when the database is unconfigured", async () => {
    // Hard rule 4: all three apps boot env-less to a graceful state. A signed-in
    // user on a DB-less deployment must reach a "not connected" screen.
    delete process.env.DATABASE_URL;
    const state = await resolveOrgSession();
    expect(state.kind).toBe("not_ready");
    // ...and it must not have gone looking for a database anyway.
    expect(db.calls).toEqual([]);
  });

  it("is not_ready when the users join row is missing", async () => {
    seedSession({ dbUser: null });
    expect((await resolveOrgSession()).kind).toBe("not_ready");
  });

  it("is not_ready when the seeded org group is absent", async () => {
    seedSession({});
    db.seed("groups", []);
    expect((await resolveOrgSession()).kind).toBe("not_ready");
  });

  it("degrades to not_ready rather than throwing when a query fails", async () => {
    // The console must still render its "not connected" screen on a deployment
    // whose database is down — that is the deployment someone is looking at.
    seedSession({});
    db.fail("groups");
    expect((await resolveOrgSession()).kind).toBe("not_ready");
  });

  /**
   * THE RE-ANIMATION GUARD, and the highest-value single assertion in this file.
   *
   * Sanitization erases the Better Auth identity but deliberately KEEPS the
   * `users` row and its memberships for referential integrity — so a stale
   * cookie-cache session (up to 5 minutes) presents a deleted account that still
   * owns a `god` membership. Resolving that to a session hands a departed
   * account the highest privilege in the deployment.
   */
  it("refuses a sanitized account even when its god membership survives", async () => {
    seedSession({
      dbUser: {
        id: "user-1",
        email: null,
        sanitizedAt: new Date("2026-07-01T00:00:00Z"),
      },
      membershipRole: "god",
    });

    const state = await resolveOrgSession();

    expect(state.kind).toBe("unauthenticated");
    // Not merely refused — it never got as far as reading the membership.
    expect(db.recorded("select", "memberships")).toHaveLength(0);
  });

  it("never rewrites a sanitized account's nulled email", async () => {
    // Clobbering it would un-erase the very PII the deletion removed, which is
    // why the email sync sits BELOW the sanitized guard rather than above it.
    seedSession({
      dbUser: {
        id: "user-1",
        email: null,
        sanitizedAt: new Date("2026-07-01T00:00:00Z"),
      },
    });

    await resolveOrgSession();

    expect(db.recorded("update", "users")).toHaveLength(0);
  });

  it("syncs a live account's email when the provider's copy has changed", async () => {
    seedSession({
      dbUser: { id: "user-1", email: "old@example.com", sanitizedAt: null },
    });

    await resolveOrgSession();

    const [sync] = db.recorded("update", "users");
    expect(sync?.values).toEqual({ email: "alice@example.com" });
  });

  it("does not write when the email already matches", async () => {
    seedSession({});
    await resolveOrgSession();
    expect(db.recorded("update", "users")).toHaveLength(0);
  });

  it("forbids a membership role that is not an org rank", async () => {
    // `orgRankFromRole` IS the console gate. `member`/`lead`/`admin` are PROJECT
    // roles; a future membership role must never accidentally open the console
    // just because somebody added it to the enum.
    seedSession({ membershipRole: "member" });
    const state = await resolveOrgSession();
    expect(state.kind).toBe("forbidden");
  });

  it("forbids an account with no membership at all", async () => {
    seedSession({ membershipRole: null });
    expect((await resolveOrgSession()).kind).toBe("forbidden");
  });

  it("resolves an org_staff membership to a session carrying its roles", async () => {
    seedSession({
      membershipRole: "org_staff",
      roles: [
        {
          id: "role-1",
          key: "suppliers.lead",
          name: "Suppliers lead",
          kind: "seeded",
          departmentId: "dept-1",
          permissions: { read: true, personal_information: true },
        },
      ],
      domains: [
        {
          domain: "suppliers",
          departmentId: "dept-1",
          departmentName: "Suppliers",
        },
      ],
    });

    const state = await resolveOrgSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.dbUserId).toBe("user-1");
    expect(state.role).toBe("org_staff");
    expect(state.membershipId).toBe("mem-1");
    expect(state.orgGroupId).toBe("org-group-1");
    expect(state.actor.roles).toHaveLength(1);
    expect(state.actor.domains.suppliers).toEqual({
      id: "dept-1",
      name: "Suppliers",
    });
  });

  it("re-sanitizes permissions read back off a role row", async () => {
    // Permissions are sanitized on the way IN as well as on the way out, so a
    // row written by anything other than the role editor — a migration, a
    // psql session — cannot smuggle a key the resolver would honour.
    seedSession({
      roles: [
        {
          id: "role-1",
          key: "custom.rogue",
          name: "Rogue",
          kind: "custom",
          departmentId: null,
          permissions: { read: true, manage_accounts: true, nonsense: true },
        },
      ],
    });

    const state = await resolveOrgSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.actor.roles[0]?.permissions).toEqual({ read: true });
  });

  it("drops a domain ownership row this build does not know", async () => {
    // A row left behind by a console area that no longer exists owns nothing,
    // rather than resolving to an ownership nobody can see or edit.
    seedSession({
      domains: [
        {
          domain: "carpentry",
          departmentId: "dept-9",
          departmentName: "Ghost",
        },
      ],
    });

    const state = await resolveOrgSession();
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.actor.domains).toEqual({});
  });
});

describe("GOD_EMAILS bootstrap", () => {
  it("grants god to a VERIFIED listed address and audits the elevation", async () => {
    process.env.GOD_EMAILS = "alice@example.com, ryan@example.com";
    seedSession({ membershipRole: null });
    // The bootstrap reads the membership, writes it, then re-reads it; the
    // second read is the one that resolves the session.
    db.seed("memberships", [[], [{ id: "mem-1", role: "god" }]]);

    const state = await resolveOrgSession();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.role).toBe("god");
    expect(db.inserted("memberships")).toEqual({
      userId: "user-1",
      groupId: "org-group-1",
      role: "god",
    });
    const [audit] = db.recorded("insert", "audit_events");
    expect(audit?.values).toMatchObject({
      actorId: "user-1",
      action: "account.elevate",
      subject: "user-1",
      meta: { email: "alice@example.com", role: "god", via: "god_emails" },
    });
  });

  it("does NOT elevate a listed address the provider has not verified", async () => {
    // An OIDC provider asserting an attacker-controlled `email` claim is the
    // whole reason this branch exists. Being on the list is not enough.
    process.env.GOD_EMAILS = "alice@example.com";
    getAuthenticatedUser.mockResolvedValue({ ...USER, emailVerified: false });
    seedSession({ membershipRole: null });

    const state = await resolveOrgSession();

    expect(state).toMatchObject({ kind: "forbidden", godEmailUnverified: true });
    expect(db.recorded("insert", "memberships")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("does not re-write or re-audit an account that is already god", async () => {
    process.env.GOD_EMAILS = "alice@example.com";
    seedSession({ membershipRole: "god" });
    db.seed("memberships", [
      [{ role: "god" }],
      [{ id: "mem-1", role: "god" }],
    ]);

    const state = await resolveOrgSession();

    expect(state.kind).toBe("ok");
    expect(db.recorded("insert", "memberships")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("does not flag godEmailUnverified for a refused address that is not listed", async () => {
    // The flag names a CONFIGURATION dead end. An ordinary burner who signed in
    // to the console must not be told about a bootstrap list they are not on.
    getAuthenticatedUser.mockResolvedValue({ ...USER, emailVerified: false });
    seedSession({ membershipRole: null });

    const state = await resolveOrgSession();
    expect(state).toMatchObject({ kind: "forbidden" });
    expect(
      (state as { godEmailUnverified?: boolean }).godEmailUnverified,
    ).toBe(false);
  });
});

describe("isGodEmail / canBootstrapGodEmail", () => {
  it("is false when GOD_EMAILS is unset or empty", () => {
    delete process.env.GOD_EMAILS;
    expect(isGodEmail("alice@example.com")).toBe(false);
    process.env.GOD_EMAILS = "";
    expect(isGodEmail("alice@example.com")).toBe(false);
  });

  it("reads a comma list, tolerating spacing and case", () => {
    process.env.GOD_EMAILS = " Alice@Example.com ,ryan@example.com ";
    expect(isGodEmail("alice@example.com")).toBe(true);
    expect(isGodEmail("ryan@example.com")).toBe(true);
    expect(isGodEmail("mallory@example.com")).toBe(false);
    expect(isGodEmail(null)).toBe(false);
  });

  it("requires verification on top of listing", () => {
    process.env.GOD_EMAILS = "alice@example.com";
    expect(canBootstrapGodEmail("alice@example.com", true)).toBe(true);
    expect(canBootstrapGodEmail("alice@example.com", false)).toBe(false);
    expect(canBootstrapGodEmail("mallory@example.com", true)).toBe(false);
  });
});

describe("requireOrgSession", () => {
  it("throws for a caller who has not cleared the gate", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    await expect(requireOrgSession()).rejects.toThrow(
      "Not authorised for the organiser console.",
    );
  });

  it("throws the core module's own refusal when the capability is missing IN THAT DOMAIN", async () => {
    // A Suppliers lead holds `delete` — in Suppliers. Asking for it on
    // registrations must be refused, and the sentence must be the one
    // @quagga/core produced (it names the department that does own it) rather
    // than a generic "not allowed".
    seedSession({
      roles: [
        {
          id: "role-1",
          key: "suppliers.lead",
          name: "Suppliers lead",
          kind: "seeded",
          departmentId: "dept-1",
          permissions: { read: true, delete: true },
        },
      ],
      domains: [
        {
          domain: "suppliers",
          departmentId: "dept-1",
          departmentName: "Suppliers",
        },
        {
          domain: "registrations",
          departmentId: "dept-2",
          departmentName: "Theme camps",
        },
      ],
    });

    await expect(
      requireOrgSession({ capability: "delete", domain: "registrations" }),
    ).rejects.toThrow(/Theme camps/);

    // ...and the same grant IS honoured in its own department. Without this
    // half, a module that refused everything would pass the test above.
    await expect(
      requireOrgSession({ capability: "delete", domain: "suppliers" }),
    ).resolves.toMatchObject({ dbUserId: "user-1" });
  });

  it("returns the session when no capability is named", async () => {
    seedSession({});
    await expect(requireOrgSession()).resolves.toMatchObject({
      role: "org_staff",
    });
  });
});

describe("requireSystemManager", () => {
  it("refuses a non-god and names the refused thing in the message", async () => {
    // The `what` argument is the whole reason this guard takes one: a screen
    // that explains department management to someone who tried to rename a camp
    // category is telling them about a different rule than the one that stopped
    // them.
    seedSession({ membershipRole: "org_staff" });
    await expect(
      requireSystemManager("change the camp categories"),
    ).rejects.toThrow(/change the camp categories/);
  });

  it("uses the roles-and-departments default when nothing is named", async () => {
    seedSession({ membershipRole: "org_staff" });
    await expect(requireSystemManager()).rejects.toThrow(
      /manage departments, roles or who holds them/,
    );
  });

  it("admits a god with no org roles at all — the anchor", async () => {
    // A System manager resolves everything whatever the role rows say. That is
    // what makes a mis-edited permissions table recoverable.
    seedSession({ membershipRole: "god", roles: [] });
    await expect(requireSystemManager()).resolves.toMatchObject({
      role: "god",
    });
  });

  it("refuses a caller who is not signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    await expect(requireSystemManager()).rejects.toThrow(
      "Not authorised for the organiser console.",
    );
  });
});

describe("canManageAccounts", () => {
  it("is true for the System manager rank and nothing else", () => {
    expect(canManageAccounts("god")).toBe(true);
    expect(canManageAccounts("org_staff")).toBe(false);
    expect(canManageAccounts("engineer")).toBe(false);
    expect(canManageAccounts("lead")).toBe(false);
    expect(canManageAccounts("member")).toBe(false);
  });
});

describe("guardConsole — the page-level gate", () => {
  it("passes a session that holds read", async () => {
    seedSession({
      roles: [
        {
          id: "role-1",
          key: "reader",
          name: "Reader",
          kind: "custom",
          departmentId: null,
          permissions: { read: true },
        },
      ],
    });

    const guard = await guardConsole();
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.session.dbUserId).toBe("user-1");
    // The discriminant is stripped: `session` is an OrgSession, not a state.
    expect("kind" in guard.session).toBe(false);
  });

  it("refuses a cleared account holding no roles, and says so", async () => {
    // TWO GATES. Clearing the door gets an account into the shell; holding
    // `read` is what lets a page load anything. An account can hold the first
    // and not the second, and that is the correct fail-closed state for a grant
    // somebody started and did not finish.
    seedSession({ roles: [] });

    const guard = await guardConsole();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;

    const html = renderToStaticMarkup(guard.node as ReactElement);
    expect(html).toContain("no org roles yet");
  });

  it("tells an account that HOLDS roles the truth about them, by name", async () => {
    // The console header renders directly above this card and lists the roles
    // by name. Saying "no org roles yet" to someone who holds two made the
    // screen and the chrome contradict each other on one viewport, and sent
    // them to ask for the wrong thing — another role, when what they need is
    // `read` added to one they already hold.
    seedSession({
      roles: [
        {
          id: "role-1",
          key: "a",
          name: "Supplier vetting",
          kind: "custom",
          departmentId: null,
          permissions: { update: true },
        },
        {
          id: "role-2",
          key: "b",
          name: "Bulletin writer",
          kind: "custom",
          departmentId: null,
          permissions: { create: true },
        },
      ],
    });

    const guard = await guardConsole();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;

    const html = renderToStaticMarkup(guard.node as ReactElement);
    expect(html).toContain("no role that opens anything yet");
    expect(html).toContain("Supplier vetting and Bulletin writer");
    expect(html).not.toContain("no org roles yet");
  });

  it("names a single held role without an 'and'", async () => {
    seedSession({
      roles: [
        {
          id: "role-1",
          key: "a",
          name: "Supplier vetting",
          kind: "custom",
          departmentId: null,
          permissions: { update: true },
        },
      ],
    });

    const guard = await guardConsole();
    if (guard.ok) throw new Error("expected the gate to refuse");
    const html = renderToStaticMarkup(guard.node as ReactElement);
    expect(html).toContain("You hold Supplier vetting");
    expect(html).toContain("it grants");
  });

  it("returns a gate node for a session that never resolved", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const guard = await guardConsole();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.node).toBeTruthy();
  });
});

describe("reportViewer", () => {
  it("is null for an unauthenticated caller", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    await expect(reportViewer()).resolves.toBeNull();
  });

  it("uses our users.id once the session resolved", async () => {
    seedSession({});
    await expect(reportViewer()).resolves.toEqual({ id: "user-1" });
  });

  it("still lets a REFUSED account file a report, under the provider's id", async () => {
    // Deliberately looser than the console gate: "the console won't let me in"
    // is precisely the report worth having, and that caller has no users.id the
    // session got far enough to read.
    seedSession({ membershipRole: "member" });
    await expect(reportViewer()).resolves.toEqual({ id: "auth-1" });
  });

  it("still lets a not_ready account file a report", async () => {
    delete process.env.DATABASE_URL;
    await expect(reportViewer()).resolves.toEqual({ id: "auth-1" });
  });
});

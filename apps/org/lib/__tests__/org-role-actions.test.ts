import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * THE SURFACE THAT EDITS THE PERMISSION MODEL ITSELF.
 *
 * Every action here is guarded on the god anchor rather than on a capability,
 * because the right to edit rights must not be grantable.
 * `org-role-lockout.test.ts` proves the GUARD TEXT is present in this file; it
 * does not prove a single refusal happens. If `deleteOrgRole` stopped honouring
 * `canDeleteOrgRoleKind`, a System manager could delete a department's permanent
 * roles and lock the whole org team out of the console, and that suite would
 * stay green.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireSystemManager = vi.fn();
vi.mock("@/lib/session", () => ({
  requireSystemManager: (what?: string) => requireSystemManager(what),
}));

import {
  ORG_DEPARTMENT_CAP,
  ORG_ROLE_CAP,
  departmentRoleRows,
} from "@quagga/core";
import {
  createDepartment,
  createOrgRole,
  deleteDepartment,
  deleteOrgRole,
  renameDepartment,
  setAccountOrgRoles,
  setDepartmentDomains,
  updateOrgRole,
} from "@/lib/actions/org-roles";

const DEPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  db = fakeDb();
  requireSystemManager.mockReset();
  requireSystemManager.mockResolvedValue({
    dbUserId: "god-1",
    orgGroupId: "org-1",
  });
});

describe("every action refuses when the anchor refuses", () => {
  it("surfaces the thrown refusal as a result instead of letting it escape", async () => {
    requireSystemManager.mockRejectedValue(
      new Error("Only a System manager may manage departments, roles or who holds them."),
    );

    const results = await Promise.all([
      createDepartment({ name: "Safety" }),
      renameDepartment({ departmentId: DEPT_ID, name: "Safety" }),
      deleteDepartment({ departmentId: DEPT_ID }),
      setDepartmentDomains({ departmentId: DEPT_ID, domains: ["suppliers"] }),
      createOrgRole({ name: "Vetting" }),
      updateOrgRole({ roleId: ROLE_ID, name: "Vetting" }),
      deleteOrgRole({ roleId: ROLE_ID }),
      setAccountOrgRoles({ userId: USER_ID, roleIds: [] }),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toMatch(/System manager/);
    }
    expect(db.calls).toEqual([]);
  });
});

describe("createDepartment", () => {
  it("refuses at the department cap rather than growing without limit", async () => {
    db.seed(
      "org_departments",
      Array.from({ length: ORG_DEPARTMENT_CAP }, (_, i) => ({
        key: `d${i}`,
        nameNormalized: `d${i}`,
      })),
    );

    const result = await createDepartment({ name: "Safety" });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      new RegExp(`already ${ORG_DEPARTMENT_CAP} departments`),
    );
    expect(db.recorded("insert", "org_departments")).toHaveLength(0);
  });

  it("refuses a duplicate name, naming the department that already has it", async () => {
    db.seed("org_departments", [{ key: "safety", nameNormalized: "safety" }]);
    const result = await createDepartment({ name: "  Safety  " });
    expect(result).toEqual({
      ok: false,
      error: 'There is already a department called "Safety".',
    });
  });

  it("refuses a blank name", async () => {
    await expect(createDepartment({ name: "   " })).resolves.toEqual({
      ok: false,
      error: "Give the department a name.",
    });
    expect(db.calls).toEqual([]);
  });

  it("SEEDS THE TWO PERMANENT ROLES in the same transaction", async () => {
    // The seeding is the feature, not a convenience: a department without its
    // lead and member roles is an org chart with nobody in it.
    db.seed("org_departments", [[], [{ id: DEPT_ID }]]);
    db.seed("org_roles", []);

    const result = await createDepartment({ name: "Safety" });

    expect(result).toEqual({ ok: true });
    const seeded = db.inserted("org_roles") as { key: string; kind: string }[];
    expect(seeded).toHaveLength(2);
    expect(seeded.map((r) => r.kind)).toEqual(["system", "system"]);
    expect(seeded.map((r) => r.key)).toEqual(
      departmentRoleRows({ id: DEPT_ID, key: "safety", name: "Safety" }).map(
        (r) => r.key,
      ),
    );
    expect(db.inserted("audit_events")).toMatchObject({
      actorId: "god-1",
      action: "org.department.create",
      subject: DEPT_ID,
    });
  });

  it("says RENAME IT FIRST when a custom role already holds a seeded name", async () => {
    // Role names are unique across the whole org, so a pre-existing custom
    // "Safety lead" would collide. A constraint error here would be unreadable.
    db.seed("org_departments", [[], [{ id: DEPT_ID }]]);
    db.seed("org_roles", [{ name: "Safety lead" }]);

    const result = await createDepartment({ name: "Safety" });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/rename it first/);
    expect(db.recorded("insert", "org_roles")).toHaveLength(0);
  });
});

describe("renameDepartment", () => {
  it("refuses a name another department already holds", async () => {
    db.seed("org_departments", [{ id: "other" }]);
    const result = await renameDepartment({
      departmentId: DEPT_ID,
      name: "Safety",
    });
    expect(result).toEqual({
      ok: false,
      error: 'There is already a department called "Safety".',
    });
  });

  it("refuses a department that vanished under the rename", async () => {
    db.seed("org_departments", [[], []]);
    await expect(
      renameDepartment({ departmentId: DEPT_ID, name: "Safety" }),
    ).resolves.toEqual({ ok: false, error: "That department is gone." });
  });

  it("renames without moving the KEY", async () => {
    // The seeded role keys are built from it, and a key that follows a label is
    // not a key.
    db.seed("org_departments", [[], [{ id: DEPT_ID }]]);

    const result = await renameDepartment({
      departmentId: DEPT_ID,
      name: "Safety and ops",
      description: "  ",
    });

    expect(result).toEqual({ ok: true });
    const values = db.recorded("update", "org_departments")[0]?.values as Record<
      string,
      unknown
    >;
    expect(values).toMatchObject({
      name: "Safety and ops",
      description: null,
    });
    expect(values.key).toBeUndefined();
  });
});

describe("deleteDepartment", () => {
  it("refuses a SYSTEM department, and explains what is still editable", async () => {
    db.seed("org_departments", [
      { id: DEPT_ID, name: "Suppliers", kind: "system" },
    ]);

    const result = await deleteDepartment({ departmentId: DEPT_ID });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/permanent department/);
    expect(db.recorded("delete", "org_departments")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("deletes a custom department and audits it", async () => {
    db.seed("org_departments", [
      { id: DEPT_ID, name: "Safety", kind: "custom" },
    ]);

    await expect(
      deleteDepartment({ departmentId: DEPT_ID }),
    ).resolves.toEqual({ ok: true });
    expect(db.recorded("delete", "org_departments")).toHaveLength(1);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "org.department.delete",
      meta: { name: "Safety" },
    });
  });

  it("refuses one that is already gone", async () => {
    db.seed("org_departments", []);
    await expect(
      deleteDepartment({ departmentId: DEPT_ID }),
    ).resolves.toEqual({ ok: false, error: "That department is already gone." });
  });
});

describe("setDepartmentDomains — a permissions change wearing an org-chart costume", () => {
  it("records before, after AND who it was taken from", async () => {
    // Giving Suppliers the `registrations` domain hands every Suppliers lead
    // every camp member's medical notes. The audit row IS the feature.
    db.seed("org_departments", [{ id: DEPT_ID, name: "Suppliers" }]);
    db.seed("org_department_domains", [
      { domain: "suppliers", departmentId: DEPT_ID },
      { domain: "registrations", departmentId: "dept-camps" },
    ]);

    const result = await setDepartmentDomains({
      departmentId: DEPT_ID,
      domains: ["suppliers", "registrations", "registrations"],
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("audit_events")).toMatchObject({
      actorId: "god-1",
      action: "org.department.domains",
      subject: DEPT_ID,
      meta: {
        name: "Suppliers",
        before: ["suppliers"],
        // Deduplicated on the way in.
        after: ["suppliers", "registrations"],
        takenFrom: ["registrations"],
      },
    });
  });

  it("writes the WHOLE SET rather than toggling one key", async () => {
    db.seed("org_departments", [{ id: DEPT_ID, name: "Suppliers" }]);
    db.seed("org_department_domains", [
      { domain: "suppliers", departmentId: DEPT_ID },
    ]);

    await setDepartmentDomains({
      departmentId: DEPT_ID,
      domains: ["bulletins"],
    });

    const inserted = db.inserted("org_department_domains") as {
      domain: string;
    }[];
    expect(inserted).toEqual([{ domain: "bulletins", departmentId: DEPT_ID }]);
    // The old rows were dropped first — the set is authoritative.
    expect(db.recorded("delete", "org_department_domains").length).toBeGreaterThan(0);
  });

  it("clears every domain when the set is empty, and inserts nothing", async () => {
    db.seed("org_departments", [{ id: DEPT_ID, name: "Suppliers" }]);
    db.seed("org_department_domains", [
      { domain: "suppliers", departmentId: DEPT_ID },
    ]);

    await setDepartmentDomains({ departmentId: DEPT_ID, domains: [] });

    expect(db.recorded("insert", "org_department_domains")).toHaveLength(0);
    expect(db.inserted("audit_events")).toMatchObject({
      meta: { after: [], takenFrom: [] },
    });
  });

  it("refuses a domain key the code does not know", async () => {
    // A forged payload must not store a key the resolver would not recognise.
    const result = await setDepartmentDomains({
      departmentId: DEPT_ID,
      domains: ["carpentry" as "suppliers"],
    });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it("refuses a department that is gone", async () => {
    db.seed("org_departments", []);
    await expect(
      setDepartmentDomains({ departmentId: DEPT_ID, domains: [] }),
    ).resolves.toEqual({ ok: false, error: "That department is gone." });
  });
});

describe("createOrgRole", () => {
  it("refuses at the role cap", async () => {
    db.seed(
      "org_roles",
      Array.from({ length: ORG_ROLE_CAP }, (_, i) => ({
        key: `r${i}`,
        nameNormalized: `r${i}`,
      })),
    );
    const result = await createOrgRole({ name: "Vetting" });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      new RegExp(`already ${ORG_ROLE_CAP} roles`),
    );
  });

  it("refuses a duplicate name", async () => {
    db.seed("org_roles", [{ key: "vetting", nameNormalized: "vetting" }]);
    await expect(createOrgRole({ name: "Vetting" })).resolves.toEqual({
      ok: false,
      error: 'There is already a role called "Vetting".',
    });
  });

  it("refuses a department that no longer exists", async () => {
    db.seed("org_roles", []);
    db.seed("org_departments", []);
    await expect(
      createOrgRole({ name: "Vetting", departmentId: DEPT_ID }),
    ).resolves.toEqual({ ok: false, error: "That department is gone." });
  });

  it("stores the capability list as the resolver's own permissions map", async () => {
    db.seed("org_roles", [[], [{ id: ROLE_ID }]]);

    const result = await createOrgRole({
      name: "Vetting",
      capabilities: ["read", "delete"],
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("org_roles")).toMatchObject({
      name: "Vetting",
      kind: "custom",
      color: "neutral",
      // Exactly the granted keys — `orgPermissionsFromKeys`' output, not the
      // raw array, so a row can never carry a shape the resolver would ignore.
      permissions: { read: true, delete: true },
    });
  });

  it("REFUSES A CAPABILITY THAT IS NOT IN THE VOCABULARY, at the zod boundary", async () => {
    // `manage_accounts` was a capability once and is now the System manager
    // RANK, precisely because the right to grant rights must not be grantable.
    // A forged payload naming it is rejected before it reaches the permissions
    // builder — and the resolver refuses it again on the way out.
    db.seed("org_roles", [[], [{ id: ROLE_ID }]]);

    const result = await createOrgRole({
      name: "Vetting",
      capabilities: ["read", "manage_accounts" as "read"],
    });

    expect(result).toMatchObject({ ok: false });
    expect(db.recorded("insert", "org_roles")).toHaveLength(0);
  });
});

describe("updateOrgRole", () => {
  const SEEDED_PAIR = {
    id: ROLE_ID,
    key: "suppliers.lead",
    kind: "system",
    departmentId: "dept-suppliers",
    permissions: { read: true },
  };

  it("refuses a role that is gone", async () => {
    db.seed("org_roles", [[]]);
    await expect(
      updateOrgRole({ roleId: ROLE_ID, name: "Vetting" }),
    ).resolves.toEqual({ ok: false, error: "That role is gone." });
  });

  it("refuses a name another role already holds", async () => {
    db.seed("org_roles", [[SEEDED_PAIR], [{ id: "other" }]]);
    await expect(
      updateOrgRole({ roleId: ROLE_ID, name: "Vetting" }),
    ).resolves.toEqual({
      ok: false,
      error: 'There is already a role called "Vetting".',
    });
  });

  it("CANNOT RESCOPE a department's seeded pair", async () => {
    // The scope IS what a "Suppliers lead" means. An attempt to move it keeps
    // the stored department rather than silently succeeding.
    db.seed("org_roles", [[SEEDED_PAIR], []]);

    await updateOrgRole({
      roleId: ROLE_ID,
      name: "Suppliers lead",
      departmentId: DEPT_ID,
      capabilities: ["read"],
    });

    expect(db.recorded("update", "org_roles")[0]?.values).toMatchObject({
      departmentId: "dept-suppliers",
    });
  });

  it("CAN rescope a custom role", async () => {
    // The other half. Without it, a module that refused every rescope would
    // pass the test above.
    db.seed("org_roles", [
      [{ ...SEEDED_PAIR, kind: "custom", key: "custom.vetting" }],
      [],
    ]);

    await updateOrgRole({
      roleId: ROLE_ID,
      name: "Vetting",
      departmentId: DEPT_ID,
    });

    expect(db.recorded("update", "org_roles")[0]?.values).toMatchObject({
      departmentId: DEPT_ID,
    });
  });

  it("audits the rights BEFORE and AFTER, both sanitized", async () => {
    db.seed("org_roles", [
      [{ ...SEEDED_PAIR, permissions: { read: true, manage_accounts: true } }],
      [],
    ]);

    await updateOrgRole({
      roleId: ROLE_ID,
      name: "Suppliers lead",
      capabilities: ["read", "update"],
    });

    expect(db.inserted("audit_events")).toMatchObject({
      action: "org.role.update",
      subject: ROLE_ID,
      meta: {
        before: { read: true },
        after: { read: true, update: true },
      },
    });
  });
});

describe("deleteOrgRole", () => {
  it("refuses a departmental seeded role, telling you to delete the DEPARTMENT", async () => {
    db.seed("org_roles", [
      {
        id: ROLE_ID,
        key: "suppliers.lead",
        name: "Suppliers lead",
        kind: "system",
        departmentId: "dept-suppliers",
      },
    ]);

    const result = await deleteOrgRole({ roleId: ROLE_ID });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /Delete the department to remove it/,
    );
    expect(db.recorded("delete", "org_roles")).toHaveLength(0);
  });

  it("gives an ORG-WIDE seeded role a different sentence", async () => {
    // There is no department to delete, so the copy must not tell them to.
    db.seed("org_roles", [
      {
        id: ROLE_ID,
        key: "org_staff",
        name: "Org staff",
        kind: "system",
        departmentId: null,
      },
    ]);

    const result = await deleteOrgRole({ roleId: ROLE_ID });

    expect((result as { error: string }).error).toMatch(
      /permanent role and cannot be deleted/,
    );
    expect((result as { error: string }).error).not.toMatch(/department/);
  });

  it("deletes a custom role and audits it", async () => {
    db.seed("org_roles", [
      {
        id: ROLE_ID,
        key: "custom.vetting",
        name: "Vetting",
        kind: "custom",
        departmentId: null,
      },
    ]);

    await expect(deleteOrgRole({ roleId: ROLE_ID })).resolves.toEqual({
      ok: true,
    });
    expect(db.recorded("delete", "org_roles")).toHaveLength(1);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "org.role.delete",
      meta: { key: "custom.vetting", name: "Vetting" },
    });
  });
});

describe("setAccountOrgRoles", () => {
  it("refuses an account with no console access", async () => {
    // Roles without a door are not a meaningful state, and creating one
    // silently would hide a half-finished grant.
    db.seed("memberships", []);
    await expect(
      setAccountOrgRoles({ userId: USER_ID, roleIds: [ROLE_ID] }),
    ).resolves.toEqual({
      ok: false,
      error:
        "That account has no console access yet, so there is nothing to assign roles to.",
    });
  });

  it("refuses a god account, because roles would change nothing", async () => {
    db.seed("memberships", [{ id: "mem-1", role: "god" }]);
    const result = await setAccountOrgRoles({
      userId: USER_ID,
      roleIds: [ROLE_ID],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /already hold everything/,
    );
  });

  it("refuses a role id that no longer exists, rather than writing a PARTIAL set", async () => {
    // A partial write here is a grant nobody asked for and a grant somebody
    // expected, at the same time.
    db.seed("memberships", [{ id: "mem-1", role: "org_staff" }]);
    db.seed("org_roles", [{ id: ROLE_ID }]);

    const result = await setAccountOrgRoles({
      userId: USER_ID,
      roleIds: [ROLE_ID, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    });

    expect(result).toEqual({
      ok: false,
      error: "One of those roles no longer exists.",
    });
    expect(db.recorded("insert", "org_role_assignments")).toHaveLength(0);
    expect(db.recorded("delete", "org_role_assignments")).toHaveLength(0);
  });

  it("replaces the whole set, so removing is the same operation as adding", async () => {
    db.seed("memberships", [{ id: "mem-1", role: "org_staff" }]);
    db.seed("org_roles", [{ id: ROLE_ID }]);

    await setAccountOrgRoles({ userId: USER_ID, roleIds: [ROLE_ID, ROLE_ID] });

    expect(db.recorded("delete", "org_role_assignments")).toHaveLength(1);
    expect(db.inserted("org_role_assignments")).toEqual([
      { membershipId: "mem-1", orgRoleId: ROLE_ID },
    ]);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "org.roles.assign",
      subject: USER_ID,
      meta: { roleIds: [ROLE_ID] },
    });
  });

  it("clears every role when the set is empty, without a pointless insert", async () => {
    db.seed("memberships", [{ id: "mem-1", role: "org_staff" }]);

    await expect(
      setAccountOrgRoles({ userId: USER_ID, roleIds: [] }),
    ).resolves.toEqual({ ok: true });

    expect(db.recorded("delete", "org_role_assignments")).toHaveLength(1);
    expect(db.recorded("insert", "org_role_assignments")).toHaveLength(0);
  });
});

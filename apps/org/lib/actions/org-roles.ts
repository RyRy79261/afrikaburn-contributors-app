"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  ORG_DEPARTMENT_CAP,
  ORG_DOMAINS,
  ORG_RANK_LABELS,
  ORG_ROLE_CAP,
  canDeleteOrgDepartmentKind,
  canDeleteOrgRoleKind,
  canRescopeOrgRole,
  cleanOrgName,
  customOrgRoleKey,
  departmentKeyFrom,
  departmentRoleRows,
  isValidDepartmentName,
  isValidOrgRoleName,
  normalizeOrgName,
  orgPermissionsFromKeys,
  sanitizeOrgPermissions,
  uniqueDepartmentKey,
} from "@quagga/core";
import { OrgCapabilityKey, RoleColor } from "@quagga/types";

import { schema, withTransaction } from "@/lib/db";
import { requireSystemManager } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// DEPARTMENTS, ROLES AND ASSIGNMENTS — SYSTEM MANAGER ONLY.
//
// Every action here starts with `requireSystemManager()`, which asks the anchor
// (`memberships.role = 'god'`) and not a capability. That is deliberate: this is
// the surface that edits permissions, so the right to use it must not itself be
// a permission anyone can grant. `manage_accounts` is refused to every role by
// the resolver for the same reason (@quagga/core `org-permissions`).
//
// Three rails these actions must never break, each with a named lockout test in
// `lib/__tests__/org-role-lockout.test.ts`:
//   1. the god bootstrap keeps working (nothing here touches `memberships.role`
//      for a god, and nothing here can remove a god's rights, because a god's
//      rights do not come from these tables);
//   2. a `system` role is never deletable, and a department's seeded pair dies
//      only with its department;
//   3. `manage_accounts` can never be stored on a role.

const RoleColorInput = RoleColor.optional();

// --- Departments ----------------------------------------------------------

const CreateDepartmentInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullish(),
});

/**
 * Create a department and SEED ITS TWO PERMANENT ROLES (lead + member).
 *
 * The seeding is the feature, not a convenience: Ryan asked for "team leads and
 * team members for each department domain" as set, permanent things. They are
 * `system` kind (undeletable, rights editable) and they cascade away with the
 * department, because a "Suppliers lead" role without a Suppliers department
 * describes nothing.
 */
export async function createDepartment(
  raw: z.input<typeof CreateDepartmentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = CreateDepartmentInput.parse(raw);
    const name = cleanOrgName(input.name);
    if (!isValidDepartmentName(name)) {
      throw new Error("Give the department a name.");
    }
    const description = input.description?.trim() || null;

    await withTransaction(async (tx) => {
      const existing = await tx
        .select({
          key: schema.orgDepartments.key,
          nameNormalized: schema.orgDepartments.nameNormalized,
        })
        .from(schema.orgDepartments);
      if (existing.length >= ORG_DEPARTMENT_CAP) {
        throw new Error(
          `That is already ${ORG_DEPARTMENT_CAP} departments — remove one before adding another.`,
        );
      }
      const normalized = normalizeOrgName(name);
      if (existing.some((d) => d.nameNormalized === normalized)) {
        throw new Error(`There is already a department called "${name}".`);
      }

      const key = uniqueDepartmentKey(
        departmentKeyFrom(name),
        existing.map((d) => d.key),
      );

      const [department] = await tx
        .insert(schema.orgDepartments)
        .values({
          key,
          name,
          nameNormalized: normalized,
          description,
          sort: existing.length,
        })
        .returning({ id: schema.orgDepartments.id });
      if (!department) throw new Error("Could not create that department.");

      const rows = departmentRoleRows({ id: department.id, key, name });
      // A role name is unique across the whole org, so a pre-existing custom
      // role called "Suppliers lead" would collide. Say so instead of throwing a
      // constraint error at them.
      const names = rows.map((r) => r.nameNormalized);
      const clash = await tx
        .select({ name: schema.orgRoles.name })
        .from(schema.orgRoles)
        .where(inArray(schema.orgRoles.nameNormalized, names))
        .limit(1);
      if (clash[0]) {
        throw new Error(
          `A role called "${clash[0].name}" already exists — rename it first, so this department's own lead and member roles can take that name.`,
        );
      }
      await tx.insert(schema.orgRoles).values(rows);

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.department.create",
        subject: department.id,
        meta: { name, key, seededRoles: rows.map((r) => r.key) },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
  });
}

const RenameDepartmentInput = z.object({
  departmentId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullish(),
});

/** Rename a department. The KEY never moves — the seeded role keys are built
 * from it, and a key that follows a label is not a key. */
export async function renameDepartment(
  raw: z.input<typeof RenameDepartmentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = RenameDepartmentInput.parse(raw);
    const name = cleanOrgName(input.name);
    if (!isValidDepartmentName(name)) {
      throw new Error("Give the department a name.");
    }

    await withTransaction(async (tx) => {
      const clash = await tx
        .select({ id: schema.orgDepartments.id })
        .from(schema.orgDepartments)
        .where(
          and(
            eq(schema.orgDepartments.nameNormalized, normalizeOrgName(name)),
            ne(schema.orgDepartments.id, input.departmentId),
          ),
        )
        .limit(1);
      if (clash[0]) {
        throw new Error(`There is already a department called "${name}".`);
      }

      const updated = await tx
        .update(schema.orgDepartments)
        .set({
          name,
          nameNormalized: normalizeOrgName(name),
          description: input.description?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.orgDepartments.id, input.departmentId))
        .returning({ id: schema.orgDepartments.id });
      if (updated.length === 0) throw new Error("That department is gone.");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.department.rename",
        subject: input.departmentId,
        meta: { name },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
  });
}

const DeleteDepartmentInput = z.object({ departmentId: z.string().uuid() });

/**
 * Delete a department. Its two seeded roles and every assignment of them go with
 * it (FK cascade) — which is exactly why the confirm copy says the holder count
 * out loud.
 */
export async function deleteDepartment(
  raw: z.input<typeof DeleteDepartmentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = DeleteDepartmentInput.parse(raw);

    await withTransaction(async (tx) => {
      const [department] = await tx
        .select({
          id: schema.orgDepartments.id,
          name: schema.orgDepartments.name,
          kind: schema.orgDepartments.kind,
        })
        .from(schema.orgDepartments)
        .where(eq(schema.orgDepartments.id, input.departmentId))
        .limit(1);
      if (!department) throw new Error("That department is already gone.");

      // A `system` department backs a deployed portal and cannot be removed —
      // the same rail roles have had since org roles v1. Everything about it
      // stays editable; only its existence is fixed.
      if (!canDeleteOrgDepartmentKind(department.kind)) {
        throw new Error(
          `${department.name} is a permanent department — it is the org side of an app that is deployed, so removing it would leave that app with nobody answering for it. You can rename it, change what it may do, and change which parts of the console it owns.`,
        );
      }

      await tx
        .delete(schema.orgDepartments)
        .where(eq(schema.orgDepartments.id, input.departmentId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.department.delete",
        subject: input.departmentId,
        meta: { name: department.name },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
  });
}

const SetDepartmentDomainsInput = z.object({
  departmentId: z.string().uuid(),
  domains: z.array(z.enum(ORG_DOMAINS)).max(ORG_DOMAINS.length),
});

/**
 * SET WHAT A DEPARTMENT OWNS — the change that makes department scoping mean
 * something.
 *
 * A domain has exactly one owner (`org_department_domains.domain` is the primary
 * key), so assigning one to a department TAKES IT from whichever department had
 * it. That is deliberate and it is why this action writes the whole set at once
 * rather than toggling one key: "Suppliers now owns supplier documents" and
 * "Safety no longer does" are the same fact, and two code paths for one fact is
 * how they drift.
 *
 * The audit row records the before and the after, because this is a
 * PERMISSIONS change wearing an org-chart costume: giving Suppliers the
 * `registrations` domain hands every Suppliers lead every camp member's medical
 * notes. `input.domains` is validated against the code's own vocabulary, so a
 * forged payload cannot store a key the resolver would not recognise (it would
 * be dropped at read anyway — belt and braces, as with permissions).
 */
export async function setDepartmentDomains(
  raw: z.input<typeof SetDepartmentDomainsInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = SetDepartmentDomainsInput.parse(raw);
    const domains = [...new Set(input.domains)];

    await withTransaction(async (tx) => {
      const [department] = await tx
        .select({
          id: schema.orgDepartments.id,
          name: schema.orgDepartments.name,
        })
        .from(schema.orgDepartments)
        .where(eq(schema.orgDepartments.id, input.departmentId))
        .limit(1);
      if (!department) throw new Error("That department is gone.");

      const before = await tx
        .select({
          domain: schema.orgDepartmentDomains.domain,
          departmentId: schema.orgDepartmentDomains.departmentId,
        })
        .from(schema.orgDepartmentDomains);

      const held = before
        .filter((d) => d.departmentId === department.id)
        .map((d) => d.domain);
      // Which departments are LOSING something to this one — named in the audit
      // row, because "who can read supply-related details now?" is a question
      // that gets asked six months later.
      const takenFrom = before.filter(
        (d) =>
          d.departmentId !== department.id &&
          domains.includes(d.domain as (typeof ORG_DOMAINS)[number]),
      );

      // Whole-set write: drop this department's rows, drop any row for a domain
      // it is claiming, then insert the new set.
      await tx
        .delete(schema.orgDepartmentDomains)
        .where(eq(schema.orgDepartmentDomains.departmentId, department.id));
      if (domains.length > 0) {
        await tx
          .delete(schema.orgDepartmentDomains)
          .where(inArray(schema.orgDepartmentDomains.domain, domains));
        await tx.insert(schema.orgDepartmentDomains).values(
          domains.map((domain) => ({
            domain,
            departmentId: department.id,
          })),
        );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.department.domains",
        subject: department.id,
        meta: {
          name: department.name,
          before: held,
          after: domains,
          takenFrom: takenFrom.map((d) => d.domain),
        },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
    // Every scoped read resolves through the ownership map, so this changes what
    // whole pages contain — not just this screen.
    revalidatePath("/");
  });
}

// --- Roles ----------------------------------------------------------------

const CreateRoleInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullish(),
  departmentId: z.string().uuid().nullish(),
  color: RoleColorInput,
  capabilities: z.array(OrgCapabilityKey).default([]),
});

/** Create a `custom` role — a System manager's own, deletable and fully editable. */
export async function createOrgRole(
  raw: z.input<typeof CreateRoleInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = CreateRoleInput.parse(raw);
    const name = cleanOrgName(input.name);
    if (!isValidOrgRoleName(name)) throw new Error("Give the role a name.");

    // `manage_accounts` is stripped here and refused by the resolver too.
    const permissions = orgPermissionsFromKeys(input.capabilities);

    await withTransaction(async (tx) => {
      const existing = await tx
        .select({
          key: schema.orgRoles.key,
          nameNormalized: schema.orgRoles.nameNormalized,
        })
        .from(schema.orgRoles);
      if (existing.length >= ORG_ROLE_CAP) {
        throw new Error(
          `That is already ${ORG_ROLE_CAP} roles — remove one before adding another.`,
        );
      }
      const normalized = normalizeOrgName(name);
      if (existing.some((r) => r.nameNormalized === normalized)) {
        throw new Error(`There is already a role called "${name}".`);
      }

      if (input.departmentId) {
        const [department] = await tx
          .select({ id: schema.orgDepartments.id })
          .from(schema.orgDepartments)
          .where(eq(schema.orgDepartments.id, input.departmentId))
          .limit(1);
        if (!department) throw new Error("That department is gone.");
      }

      const [role] = await tx
        .insert(schema.orgRoles)
        .values({
          key: customOrgRoleKey(
            name,
            existing.map((r) => r.key),
          ),
          departmentId: input.departmentId ?? null,
          name,
          nameNormalized: normalized,
          description: input.description?.trim() || null,
          kind: "custom",
          color: input.color ?? "neutral",
          permissions,
          sort: 500 + existing.length,
        })
        .returning({ id: schema.orgRoles.id });
      if (!role) throw new Error("Could not create that role.");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.role.create",
        subject: role.id,
        meta: {
          name,
          departmentId: input.departmentId ?? null,
          permissions,
        },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
  });
}

const UpdateRoleInput = z.object({
  roleId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullish(),
  departmentId: z.string().uuid().nullish(),
  color: RoleColorInput,
  capabilities: z.array(OrgCapabilityKey).default([]),
});

/**
 * Edit a role: its label, its colour, its department scope and — the point of
 * the whole change — ITS RIGHTS. `system` roles are editable here too; only
 * their existence is permanent, and a department's seeded pair keeps its
 * department (`canRescopeOrgRole`) because that scope is what it means.
 */
export async function updateOrgRole(
  raw: z.input<typeof UpdateRoleInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = UpdateRoleInput.parse(raw);
    const name = cleanOrgName(input.name);
    if (!isValidOrgRoleName(name)) throw new Error("Give the role a name.");
    const permissions = orgPermissionsFromKeys(input.capabilities);

    await withTransaction(async (tx) => {
      const [role] = await tx
        .select({
          id: schema.orgRoles.id,
          key: schema.orgRoles.key,
          kind: schema.orgRoles.kind,
          departmentId: schema.orgRoles.departmentId,
          permissions: schema.orgRoles.permissions,
        })
        .from(schema.orgRoles)
        .where(eq(schema.orgRoles.id, input.roleId))
        .limit(1);
      if (!role) throw new Error("That role is gone.");

      const clash = await tx
        .select({ id: schema.orgRoles.id })
        .from(schema.orgRoles)
        .where(
          and(
            eq(schema.orgRoles.nameNormalized, normalizeOrgName(name)),
            ne(schema.orgRoles.id, input.roleId),
          ),
        )
        .limit(1);
      if (clash[0])
        throw new Error(`There is already a role called "${name}".`);

      const departmentId = canRescopeOrgRole(role)
        ? (input.departmentId ?? null)
        : role.departmentId;

      await tx
        .update(schema.orgRoles)
        .set({
          name,
          nameNormalized: normalizeOrgName(name),
          description: input.description?.trim() || null,
          departmentId,
          color: input.color ?? "neutral",
          permissions,
          updatedAt: new Date(),
        })
        .where(eq(schema.orgRoles.id, input.roleId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.role.update",
        subject: input.roleId,
        meta: {
          key: role.key,
          name,
          departmentId,
          before: sanitizeOrgPermissions(role.permissions),
          after: permissions,
        },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
    revalidatePath("/");
  });
}

const DeleteRoleInput = z.object({ roleId: z.string().uuid() });

/** Delete a role. `system` roles refuse — permanence is enforced server-side,
 * not by hiding the button. */
export async function deleteOrgRole(
  raw: z.input<typeof DeleteRoleInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = DeleteRoleInput.parse(raw);

    await withTransaction(async (tx) => {
      const [role] = await tx
        .select({
          id: schema.orgRoles.id,
          key: schema.orgRoles.key,
          name: schema.orgRoles.name,
          kind: schema.orgRoles.kind,
          departmentId: schema.orgRoles.departmentId,
        })
        .from(schema.orgRoles)
        .where(eq(schema.orgRoles.id, input.roleId))
        .limit(1);
      if (!role) throw new Error("That role is already gone.");

      if (!canDeleteOrgRoleKind(role.kind)) {
        throw new Error(
          role.departmentId
            ? `"${role.name}" is one of its department's permanent roles. Delete the department to remove it, or edit what it may do.`
            : `"${role.name}" is a permanent role and cannot be deleted. You can rename it or change what it may do.`,
        );
      }

      await tx.delete(schema.orgRoles).where(eq(schema.orgRoles.id, role.id));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.role.delete",
        subject: role.id,
        meta: { key: role.key, name: role.name },
      });
    });

    revalidatePath("/system/roles");
    revalidatePath("/system");
    revalidatePath("/accounts");
  });
}

// --- Assignment -----------------------------------------------------------

const SetAccountRolesInput = z.object({
  userId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()).max(ORG_ROLE_CAP),
});

/**
 * Set exactly which org roles an account holds — the whole set, so removing is
 * the same operation as adding and there is no drift between two code paths.
 *
 * The target must already hold console access; roles without a door are not a
 * meaningful state, and creating one silently would hide a half-finished grant.
 */
export async function setAccountOrgRoles(
  raw: z.input<typeof SetAccountRolesInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager();
    const input = SetAccountRolesInput.parse(raw);

    await withTransaction(async (tx) => {
      const [membership] = await tx
        .select({
          id: schema.memberships.id,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, input.userId),
            eq(schema.memberships.groupId, session.orgGroupId),
          ),
        )
        .limit(1);
      if (!membership) {
        throw new Error(
          "That account has no console access yet, so there is nothing to assign roles to.",
        );
      }
      if (membership.role === "god") {
        throw new Error(
          `${ORG_RANK_LABELS.god} accounts already hold everything — roles would change nothing.`,
        );
      }

      const roleIds = [...new Set(input.roleIds)];
      if (roleIds.length > 0) {
        const found = await tx
          .select({ id: schema.orgRoles.id })
          .from(schema.orgRoles)
          .where(inArray(schema.orgRoles.id, roleIds));
        if (found.length !== roleIds.length) {
          throw new Error("One of those roles no longer exists.");
        }
      }

      await tx
        .delete(schema.orgRoleAssignments)
        .where(eq(schema.orgRoleAssignments.membershipId, membership.id));
      if (roleIds.length > 0) {
        await tx.insert(schema.orgRoleAssignments).values(
          roleIds.map((orgRoleId) => ({
            membershipId: membership.id,
            orgRoleId,
          })),
        );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "org.roles.assign",
        subject: input.userId,
        meta: { roleIds },
      });
    });

    revalidatePath("/accounts");
    revalidatePath("/system");
  });
}

// (There is deliberately no "restore the seeded roles" action here. The DEPLOY
// ensures them on every run — including on an already-seeded database, which is
// the case that would otherwise leave the whole org team able to sign in and do
// nothing. A console button for it would be a second, manual path to the same
// invariant, and the one that gets forgotten. See packages/db/src/migrate.ts.)

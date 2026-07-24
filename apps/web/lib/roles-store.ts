import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  cleanRoleName,
  defaultProjectRoleRows,
  isValidRoleName,
  normalizeRoleName,
  PROJECT_ROLE_CAP,
  roleCapReached,
  roleNameConflicts,
} from "@quagga/core";
import { db, schema } from "./db";

// Custom per-project roles (questionnaire-spec §"Custom project roles"). These
// are labels for organisation + questionnaire audiences — separate from the
// structural `memberships.role` ladder. All authz is enforced by the calling
// server actions (project lead/admin only, via @quagga/core predicates); this
// store is the persistence layer only.

export interface ProjectRole {
  id: string;
  name: string;
  isDefault: boolean;
  sort: number;
}

/**
 * Seed the default roles (Captain / Team lead / Burn member) for a group that
 * has none yet — camps created before this feature shipped predate the seed, so
 * we top them up lazily the first time their roles are read. Idempotent: the
 * `unique(group_id, name_normalized)` index makes a concurrent double-seed a
 * no-op.
 */
export async function ensureDefaultRoles(groupId: string): Promise<void> {
  const existing = await db()
    .select({ id: schema.projectRoles.id })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId))
    .limit(1);
  if (existing[0]) return;
  await db()
    .insert(schema.projectRoles)
    .values(defaultProjectRoleRows(groupId))
    .onConflictDoNothing({
      target: [schema.projectRoles.groupId, schema.projectRoles.nameNormalized],
    });
}

/** All custom roles for a group, ordered by sort then name (default-seeded). */
export async function listRoles(groupId: string): Promise<ProjectRole[]> {
  await ensureDefaultRoles(groupId);
  const rows = await db()
    .select({
      id: schema.projectRoles.id,
      name: schema.projectRoles.name,
      isDefault: schema.projectRoles.isDefault,
      sort: schema.projectRoles.sort,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId))
    .orderBy(asc(schema.projectRoles.sort), asc(schema.projectRoles.name));
  return rows;
}

/**
 * membership_id → the custom role ids it holds, for every member of the group.
 * Only assignments whose membership is in THIS group are returned (the join
 * scopes it), so a stray assignment can't leak across projects.
 */
export async function getRoleAssignments(
  groupId: string,
): Promise<Map<string, string[]>> {
  const rows = await db()
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .where(eq(schema.memberships.groupId, groupId));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.membershipId) ?? [];
    list.push(r.projectRoleId);
    map.set(r.membershipId, list);
  }
  return map;
}

export type RoleMutationResult = { ok: true } | { ok: false; error: string };

/** Add a custom role to a group (validated + normalized-unique). */
export async function createRole(
  groupId: string,
  rawName: string,
): Promise<RoleMutationResult> {
  const name = cleanRoleName(rawName);
  if (!isValidRoleName(name)) {
    return { ok: false, error: "Give the role a short, non-empty name." };
  }
  const existing = await listRoles(groupId);
  if (roleCapReached(existing.length)) {
    return {
      ok: false,
      error: `A camp can have at most ${PROJECT_ROLE_CAP} roles. Remove one before adding another.`,
    };
  }
  if (roleNameConflicts(existing.map((r) => r.name), name)) {
    return { ok: false, error: "A role with that name already exists." };
  }
  const nextSort =
    existing.reduce((max, r) => Math.max(max, r.sort), -1) + 1;
  try {
    await db().insert(schema.projectRoles).values({
      groupId,
      name,
      nameNormalized: normalizeRoleName(name),
      isDefault: false,
      sort: nextSort,
    });
  } catch {
    return { ok: false, error: "A role with that name already exists." };
  }
  return { ok: true };
}

/** Rename an existing role (unique-safe; a pure case/punct change is allowed). */
export async function renameRole(
  groupId: string,
  roleId: string,
  rawName: string,
): Promise<RoleMutationResult> {
  const name = cleanRoleName(rawName);
  if (!isValidRoleName(name)) {
    return { ok: false, error: "Give the role a short, non-empty name." };
  }
  const existing = await listRoles(groupId);
  const target = existing.find((r) => r.id === roleId);
  if (!target) return { ok: false, error: "That role no longer exists." };
  if (
    roleNameConflicts(
      existing.map((r) => r.name),
      name,
      normalizeRoleName(target.name),
    )
  ) {
    return { ok: false, error: "A role with that name already exists." };
  }
  try {
    await db()
      .update(schema.projectRoles)
      .set({
        name,
        nameNormalized: normalizeRoleName(name),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.projectRoles.id, roleId),
          eq(schema.projectRoles.groupId, groupId),
        ),
      );
  } catch {
    return { ok: false, error: "A role with that name already exists." };
  }
  return { ok: true };
}

/**
 * Remove a CUSTOM role (its assignments cascade via the FK). Default roles
 * (Captain / Team lead / Burn member) are permanent fixtures and cannot be
 * deleted (questionnaire-spec §"Custom project roles CRUD" + §"Role kinds") —
 * deleting one is unrecoverable because `ensureDefaultRoles` never re-seeds once
 * any role exists.
 */
export async function removeRole(
  groupId: string,
  roleId: string,
): Promise<RoleMutationResult> {
  const existing = await listRoles(groupId);
  const target = existing.find((r) => r.id === roleId);
  if (!target) return { ok: false, error: "That role no longer exists." };
  if (target.isDefault) {
    return { ok: false, error: "Default roles can't be deleted." };
  }
  await db()
    .delete(schema.projectRoles)
    .where(
      and(
        eq(schema.projectRoles.id, roleId),
        eq(schema.projectRoles.groupId, groupId),
      ),
    );
  return { ok: true };
}

/**
 * Replace a member's custom-role set. Verifies the membership belongs to the
 * group and every role id is one of the group's own roles (cross-project
 * assignment is impossible), then swaps the assignment rows.
 */
export async function setMemberRoles(
  groupId: string,
  membershipId: string,
  roleIds: readonly string[],
): Promise<RoleMutationResult> {
  const membership = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  if (!membership[0]) {
    return { ok: false, error: "That member isn't in this camp." };
  }

  const groupRoles = await listRoles(groupId);
  const valid = new Set(groupRoles.map((r) => r.id));
  const wanted = [...new Set(roleIds)].filter((id) => valid.has(id));

  await db()
    .delete(schema.memberRoleAssignments)
    .where(eq(schema.memberRoleAssignments.membershipId, membershipId));
  if (wanted.length > 0) {
    await db()
      .insert(schema.memberRoleAssignments)
      .values(wanted.map((projectRoleId) => ({ membershipId, projectRoleId })))
      .onConflictDoNothing({
        target: [
          schema.memberRoleAssignments.membershipId,
          schema.memberRoleAssignments.projectRoleId,
        ],
      });
  }
  return { ok: true };
}

/** Membership ids in a group that hold ANY of the given role ids (audience). */
export async function membershipIdsWithRoles(
  groupId: string,
  roleIds: readonly string[],
): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await db()
    .select({ membershipId: schema.memberRoleAssignments.membershipId })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        inArray(schema.memberRoleAssignments.projectRoleId, [...roleIds]),
      ),
    );
  return [...new Set(rows.map((r) => r.membershipId))];
}

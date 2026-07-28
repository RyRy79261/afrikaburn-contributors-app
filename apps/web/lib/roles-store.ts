import "server-only";

import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  cleanRoleName,
  defaultProjectRoleRows,
  officerRoleRows,
  teamLeadScopePatch,
  canDeleteRoleKind,
  canRenameRoleKind,
  enforceKindPermissions,
  isValidRoleName,
  normalizeRoleName,
  officerAcceptedNotification,
  officerAssignmentRequestNotification,
  officerRequirements,
  officerSlotFilled,
  outstandingOfficers,
  roleGrantsElevatedPrivileges,
  soundLevelFromValue,
  PROJECT_ROLE_CAP,
  roleCapReached,
  roleNameConflicts,
  type OfficerRequirement,
  type OutstandingOfficers,
} from "@quagga/core";
import type {
  MembershipRole,
  OfficerKey,
  ProjectPermissions,
  ProjectRoleKind,
  RoleAssignmentConsent,
  RoleColor,
} from "@quagga/types";
import { db, schema, withTransaction } from "./db";
import { insertNotifications } from "./notifications";

/** Camp name + slug for an officer notification (best-effort lookup). */
async function campNameAndSlug(
  groupId: string,
): Promise<{ name: string; slug: string } | null> {
  const [g] = await db()
    .select({ name: schema.groups.name, slug: schema.groups.slug })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  return g ?? null;
}

// Custom per-project roles (questionnaire-spec §"Roles v2" + §"Officer roles").
// Labels for organisation + questionnaire audiences + officer registrations —
// separate from the structural `memberships.role` ladder. All authz is enforced
// by the calling server actions (via @quagga/core predicates); this store is the
// persistence layer only.

export interface ProjectRole {
  id: string;
  name: string;
  isDefault: boolean;
  sort: number;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
  permissions: ProjectPermissions;
  officerKey: OfficerKey | null;
}

/**
 * Seed the Roles v2 default + officer roles for a group that has none yet, or
 * top up a pre-feature group. Idempotent: `unique(group_id, name_normalized)`
 * makes concurrent double-seeds a no-op. Also re-scopes Team lead's
 * questionnaire audience to the baseline role id once the rows exist.
 *
 * ## Why this is `cache()`d, and why the insert is one statement
 *
 * This runs on a READ path — `listRoles` calls it first — and the camp
 * dashboard reaches `listRoles` THREE times in one render (directly, and
 * inside `getMemberPermissions` and `getOfficerStatus`). All three run
 * concurrently in the page's `Promise.all`, so on a camp whose roles do not
 * exist yet all three saw an empty table, all three decided to seed, and each
 * then issued EIGHT separate inserts one after another (3 default roles + 5
 * officer roles) — 24 sequential round trips to write eight rows, plus three
 * redundant existence probes.
 *
 * Measured against the local stack on 28 Jul: a single camp-member spec issued
 * 72 `insert into project_roles` statements across its camps. On a laptop that
 * is invisible; through the dev SQL proxy at 152 ms a statement it was not.
 * It was NOT the main cause of the `/camps/[slug]` timeouts — the proxy itself
 * was, and that is documented where it belongs (packages/db/src/index.ts).
 * This is a real cost on its own terms, in production too, which is why it is
 * fixed here rather than left to the transport.
 *
 * `cache()` collapses the three calls to one per request, exactly as
 * `ensureCampUser` does for the same reason (see lib/session.ts — also a write
 * on a read path). One multi-row insert collapses the eight round trips to one.
 * Together: 27 statements down to 2. The conflict target is unchanged, so
 * two concurrent REQUESTS still race harmlessly.
 */
export const ensureDefaultRoles = cache(async function ensureDefaultRoles(
  groupId: string,
): Promise<void> {
  const existing = await db()
    .select({
      id: schema.projectRoles.id,
      kind: schema.projectRoles.kind,
      officerKey: schema.projectRoles.officerKey,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId));

  const haveOfficer = existing.some((r) => r.kind === "officer");
  const haveAny = existing.length > 0;

  const rows = [
    ...(haveAny ? [] : defaultProjectRoleRows(groupId)),
    ...(haveOfficer ? [] : officerRoleRows(groupId)),
  ];
  if (rows.length > 0) {
    await db()
      .insert(schema.projectRoles)
      .values(rows)
      .onConflictDoNothing({
        target: [
          schema.projectRoles.groupId,
          schema.projectRoles.nameNormalized,
        ],
      });
  }

  if (!haveAny) {
    const seeded = await db()
      .select({ id: schema.projectRoles.id, kind: schema.projectRoles.kind })
      .from(schema.projectRoles)
      .where(eq(schema.projectRoles.groupId, groupId));
    const patch = teamLeadScopePatch(seeded);
    if (patch) {
      await db()
        .update(schema.projectRoles)
        .set({ permissions: patch.permissions, updatedAt: new Date() })
        .where(eq(schema.projectRoles.id, patch.roleId));
    }
  }
});

/** All roles for a group, ordered by sort then name (default-seeded first). */
export async function listRoles(groupId: string): Promise<ProjectRole[]> {
  await ensureDefaultRoles(groupId);
  const rows = await db()
    .select({
      id: schema.projectRoles.id,
      name: schema.projectRoles.name,
      isDefault: schema.projectRoles.isDefault,
      sort: schema.projectRoles.sort,
      kind: schema.projectRoles.kind,
      color: schema.projectRoles.color,
      emoji: schema.projectRoles.emoji,
      permissions: schema.projectRoles.permissions,
      officerKey: schema.projectRoles.officerKey,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId))
    .orderBy(asc(schema.projectRoles.sort), asc(schema.projectRoles.name));
  return rows.map((r) => ({
    ...r,
    officerKey: (r.officerKey as OfficerKey | null) ?? null,
  }));
}

/** An assignment with its consent state (officer roles carry pending/accepted). */
export interface RoleAssignmentRow {
  projectRoleId: string;
  consent: RoleAssignmentConsent;
  orgVisible: boolean;
}

/**
 * membership_id → its role assignments (with consent), for every member of the
 * group. The join scopes it so stray assignments can't leak across projects.
 */
export async function getRoleAssignments(
  groupId: string,
): Promise<Map<string, RoleAssignmentRow[]>> {
  const rows = await db()
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
      consent: schema.memberRoleAssignments.consentStatus,
      orgVisible: schema.memberRoleAssignments.orgVisible,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .where(eq(schema.memberships.groupId, groupId));
  const map = new Map<string, RoleAssignmentRow[]>();
  for (const r of rows) {
    const list = map.get(r.membershipId) ?? [];
    list.push({
      projectRoleId: r.projectRoleId,
      consent: r.consent,
      orgVisible: r.orgVisible,
    });
    map.set(r.membershipId, list);
  }
  return map;
}

export type RoleMutationResult = { ok: true } | { ok: false; error: string };

/** Add a custom role to a group (validated + normalized-unique). */
export async function createRole(
  groupId: string,
  rawName: string,
  opts?: { color?: RoleColor; emoji?: string | null },
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
  if (
    roleNameConflicts(
      existing.map((r) => r.name),
      name,
    )
  ) {
    return { ok: false, error: "A role with that name already exists." };
  }
  const nextSort = existing.reduce((max, r) => Math.max(max, r.sort), -1) + 1;
  try {
    await db()
      .insert(schema.projectRoles)
      .values({
        groupId,
        name,
        nameNormalized: normalizeRoleName(name),
        isDefault: false,
        sort: nextSort,
        kind: "custom",
        color: opts?.color ?? "neutral",
        emoji: opts?.emoji ?? null,
        permissions: {},
      });
  } catch {
    return { ok: false, error: "A role with that name already exists." };
  }
  return { ok: true };
}

/** Rename a role (kind-guarded — officers are never renameable). */
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
  if (!canRenameRoleKind(target.kind)) {
    return { ok: false, error: "Officer roles can't be renamed." };
  }
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

/** Recolour / re-emoji a role (free for any kind). */
export async function setRoleAppearance(
  groupId: string,
  roleId: string,
  appearance: { color?: RoleColor; emoji?: string | null },
): Promise<RoleMutationResult> {
  const existing = await listRoles(groupId);
  const target = existing.find((r) => r.id === roleId);
  if (!target) return { ok: false, error: "That role no longer exists." };
  // Officers are org-uniform: their display is fixed by the catalog.
  if (target.kind === "officer") {
    return {
      ok: false,
      error: "Officer roles use the AfrikaBurn catalog styling.",
    };
  }
  await db()
    .update(schema.projectRoles)
    .set({
      color: appearance.color ?? target.color,
      emoji: appearance.emoji === undefined ? target.emoji : appearance.emoji,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.projectRoles.id, roleId),
        eq(schema.projectRoles.groupId, groupId),
      ),
    );
  return { ok: true };
}

/**
 * Set a role's permissions (kind-aware). Captain permissions are LOCKED to all
 * — enforced here regardless of what the caller passes. Baseline/default/custom/
 * officer keep the supplied permissions.
 */
export async function setRolePermissions(
  groupId: string,
  roleId: string,
  permissions: ProjectPermissions,
): Promise<RoleMutationResult> {
  const existing = await listRoles(groupId);
  const target = existing.find((r) => r.id === roleId);
  if (!target) return { ok: false, error: "That role no longer exists." };
  const safe = enforceKindPermissions(target.kind, permissions);
  await db()
    .update(schema.projectRoles)
    .set({ permissions: safe, updatedAt: new Date() })
    .where(
      and(
        eq(schema.projectRoles.id, roleId),
        eq(schema.projectRoles.groupId, groupId),
      ),
    );
  return { ok: true };
}

/**
 * Remove a role — CUSTOM roles only (its assignments cascade). Captain/baseline/
 * default/officer are permanent fixtures (questionnaire-spec §"Role kinds").
 */
export async function removeRole(
  groupId: string,
  roleId: string,
): Promise<RoleMutationResult> {
  const existing = await listRoles(groupId);
  const target = existing.find((r) => r.id === roleId);
  if (!target) return { ok: false, error: "That role no longer exists." };
  if (!canDeleteRoleKind(target.kind)) {
    return { ok: false, error: "Only custom roles can be deleted." };
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
 * Replace a member's NON-OFFICER, non-baseline role set (the quick-assign path).
 * Baseline is derived (everyone holds it, never stored); officers use the
 * consent flow (`assignOfficer`). Verifies the membership belongs to the group
 * and every role id is an assignable role of this group.
 *
 * `allowElevated` guards privilege escalation: an `assign_roles`-only caller may
 * NOT hand out (or self-assign) a role that carries manage_roles/manage_members
 * or the Captain role (all permissions). Only a manage_roles holder / structural
 * lead·admin passes `allowElevated: true` (questionnaire-spec §"Roles v2" — the
 * escalation clause sanctions only manage_roles holders).
 */
export async function setMemberRoles(
  groupId: string,
  membershipId: string,
  roleIds: readonly string[],
  opts?: { allowElevated?: boolean },
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
  // Assignable via quick-assign: not baseline (derived), not officer (consent).
  const assignable = new Map(
    groupRoles
      .filter((r) => r.kind !== "baseline" && r.kind !== "officer")
      .map((r) => [r.id, r]),
  );
  const wanted = [...new Set(roleIds)].filter((id) => assignable.has(id));

  // Escalation guard: only manage_roles holders may hand out roles that grant
  // role-/member-management (or Captain). Prevents an assign_roles-only holder
  // from self-assigning Captain and acquiring every project permission.
  if (!opts?.allowElevated) {
    const grantsElevated = wanted.some((id) => {
      const role = assignable.get(id);
      return role
        ? roleGrantsElevatedPrivileges(role.kind, role.permissions)
        : false;
    });
    if (grantsElevated) {
      return {
        ok: false,
        error:
          "Only a role manager can assign roles that manage roles or members.",
      };
    }
  }

  // Replace the assignable (non-officer, non-baseline) assignment set: remove the
  // old ones then add the wanted ones, atomically. Without a transaction a
  // failure between the delete and the insert would strip a member of their roles
  // without granting the replacements — a silent authz downgrade.
  const assignableIds = [...assignable.keys()];
  await withTransaction(async (tx) => {
    if (assignableIds.length > 0) {
      await tx
        .delete(schema.memberRoleAssignments)
        .where(
          and(
            eq(schema.memberRoleAssignments.membershipId, membershipId),
            inArray(schema.memberRoleAssignments.projectRoleId, assignableIds),
          ),
        );
    }
    if (wanted.length > 0) {
      await tx
        .insert(schema.memberRoleAssignments)
        .values(
          wanted.map((projectRoleId) => ({
            membershipId,
            projectRoleId,
            consentStatus: "accepted" as RoleAssignmentConsent,
            orgVisible: false,
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.memberRoleAssignments.membershipId,
            schema.memberRoleAssignments.projectRoleId,
          ],
        });
    }
  });
  return { ok: true };
}

// --- Officer registrations (consent flow) --------------------------------

/**
 * Assign a member to an OFFICER role — creates a PENDING officer registration
 * the member must accept (questionnaire-spec §"Officers are ALSO
 * registrations"). Re-assigning resets to pending (not org-visible).
 */
export async function assignOfficer(
  groupId: string,
  membershipId: string,
  roleId: string,
): Promise<RoleMutationResult> {
  const roles = await listRoles(groupId);
  const role = roles.find((r) => r.id === roleId && r.kind === "officer");
  if (!role) return { ok: false, error: "That officer role doesn't exist." };
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
  if (!membership[0])
    return { ok: false, error: "That member isn't in this camp." };

  await db()
    .insert(schema.memberRoleAssignments)
    .values({
      membershipId,
      projectRoleId: roleId,
      consentStatus: "pending",
      acceptedAt: null,
      orgVisible: false,
    })
    .onConflictDoUpdate({
      target: [
        schema.memberRoleAssignments.membershipId,
        schema.memberRoleAssignments.projectRoleId,
      ],
      set: { consentStatus: "pending", acceptedAt: null, orgVisible: false },
    });

  // Event hook: tell the assigned member they have an officer registration to
  // accept (consent flow). Thin + best-effort — never fails the assignment.
  try {
    const [m] = await db()
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId))
      .limit(1);
    const camp = await campNameAndSlug(groupId);
    if (m && camp) {
      await insertNotifications(db(), [
        {
          ...officerAssignmentRequestNotification({
            officerLabel: role.name,
            campName: camp.name,
            campSlug: camp.slug,
          }),
          userId: m.userId,
          // A camp asked one of its own members to take a role.
          origin: "camp" as const,
          linkApp: "web" as const,
        },
      ]);
    }
  } catch (err) {
    console.error("[notifications] officer assignment hook failed", err);
  }
  return { ok: true };
}

/** Remove an officer assignment (frees the slot). */
export async function unassignOfficer(
  groupId: string,
  membershipId: string,
  roleId: string,
): Promise<RoleMutationResult> {
  // SCOPED TO THE CAMP, exactly as `assignOfficer` above is.
  //
  // This took `groupId` and never used it, deleting on (membershipId, roleId)
  // alone. Both of those arrive FROM THE CLIENT
  // (apps/web/app/(app)/camps/[slug]/actions.ts:302), while the permission check
  // upstream authorises the caller only for the camp named by `slug`. So a lead
  // of camp A could post camp B's membership and role ids, clear the permission
  // gate on their own camp, and strip an officer from a camp they have nothing to
  // do with — a cross-camp write, in the officer model that decides who
  // AfrikaBurn may contact about safety.
  //
  // The role lookup is per-group and the membership must belong to the same
  // group, so a foreign id now fails the same way an unknown one does.
  const roles = await listRoles(groupId);
  const role = roles.find((r) => r.id === roleId && r.officerKey !== null);
  if (!role) return { ok: false, error: "That officer role doesn't exist." };

  const [membership] = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  if (!membership) {
    return { ok: false, error: "That member isn't in this camp." };
  }

  await db()
    .delete(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.projectRoleId, roleId),
      ),
    );
  return { ok: true };
}

/** A pending officer invitation awaiting the current user's consent. */
export interface PendingOfficerConsent {
  membershipId: string;
  roleId: string;
  officerKey: OfficerKey;
  officerName: string;
  emoji: string | null;
  groupId: string;
  groupName: string;
  groupSlug: string;
}

/** Pending officer registrations the given user must accept or decline. */
export async function pendingOfficerConsents(
  userId: string,
): Promise<PendingOfficerConsent[]> {
  const rows = await db()
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      roleId: schema.projectRoles.id,
      officerKey: schema.projectRoles.officerKey,
      officerName: schema.projectRoles.name,
      emoji: schema.projectRoles.emoji,
      groupId: schema.groups.id,
      groupName: schema.groups.name,
      groupSlug: schema.groups.slug,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .innerJoin(
      schema.projectRoles,
      eq(schema.projectRoles.id, schema.memberRoleAssignments.projectRoleId),
    )
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberRoleAssignments.consentStatus, "pending"),
        eq(schema.projectRoles.kind, "officer"),
      ),
    );
  return rows
    .filter((r) => r.officerKey !== null)
    .map((r) => ({
      membershipId: r.membershipId,
      roleId: r.roleId,
      officerKey: r.officerKey as OfficerKey,
      officerName: r.officerName,
      emoji: r.emoji,
      groupId: r.groupId,
      groupName: r.groupName,
      groupSlug: r.groupSlug,
    }));
}

/**
 * The current user's response to an officer registration. Accept → org-visible
 * (the SINGLE channel that shares their contact with the org); decline → removes
 * the assignment, leaving the slot unassigned.
 */
export async function respondToOfficer(
  userId: string,
  groupId: string,
  roleId: string,
  accept: boolean,
): Promise<RoleMutationResult> {
  const membership = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  const membershipId = membership[0]?.id;
  if (!membershipId) return { ok: false, error: "You're not in this camp." };

  if (!accept) {
    await db()
      .delete(schema.memberRoleAssignments)
      .where(
        and(
          eq(schema.memberRoleAssignments.membershipId, membershipId),
          eq(schema.memberRoleAssignments.projectRoleId, roleId),
        ),
      );
    return { ok: true };
  }

  await db()
    .update(schema.memberRoleAssignments)
    .set({
      consentStatus: "accepted",
      acceptedAt: new Date(),
      orgVisible: true,
    })
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.projectRoleId, roleId),
      ),
    );

  // Event hook: confirm the acceptance back to the officer (org can now reach
  // them). Thin + best-effort.
  try {
    const [role] = await db()
      .select({ name: schema.projectRoles.name })
      .from(schema.projectRoles)
      .where(eq(schema.projectRoles.id, roleId))
      .limit(1);
    const camp = await campNameAndSlug(groupId);
    if (role && camp) {
      await insertNotifications(db(), [
        {
          ...officerAcceptedNotification({
            officerLabel: role.name,
            campName: camp.name,
            campSlug: camp.slug,
          }),
          userId,
          origin: "camp" as const,
          linkApp: "web" as const,
        },
      ]);
    }
  } catch (err) {
    console.error("[notifications] officer acceptance hook failed", err);
  }
  return { ok: true };
}

// --- Permission lookups (authz for role/officer/questionnaire actions) ----

export interface ViewerPermissionMembership {
  structuralRole: MembershipRole;
  rolePermissions: ProjectPermissions[];
}

/**
 * The viewer's permission inputs for a group: their structural role + the
 * permissions of every role they hold, INCLUDING the derived baseline role
 * (everyone holds it). Feeds `hasProjectPermission` / `canManageQuestionnaire-
 * Audience` at the action layer. Returns null when the user isn't a member.
 */
export async function getMemberPermissions(
  groupId: string,
  userId: string,
): Promise<ViewerPermissionMembership | null> {
  const membership = await db()
    .select({ id: schema.memberships.id, role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  const m = membership[0];
  if (!m) return null;

  const roles = await listRoles(groupId);
  const baseline = roles.find((r) => r.kind === "baseline");

  const held = await db()
    .select({ projectRoleId: schema.memberRoleAssignments.projectRoleId })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, m.id),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    );
  const heldIds = new Set(held.map((h) => h.projectRoleId));

  const rolePermissions: ProjectPermissions[] = [];
  // Baseline is held by everyone (derived — no stored assignment).
  if (baseline) rolePermissions.push(baseline.permissions);
  for (const r of roles) {
    if (r.kind === "baseline") continue;
    if (heldIds.has(r.id)) rolePermissions.push(r.permissions);
  }

  return { structuralRole: m.role, rolePermissions };
}

/** The baseline role id for a group (the "everyone" audience), or null. */
export async function getBaselineRoleId(
  groupId: string,
): Promise<string | null> {
  const roles = await listRoles(groupId);
  return roles.find((r) => r.kind === "baseline")?.id ?? null;
}

// --- Officer status (settings Officers section + dashboard badge) ---------

export interface OfficerAssignmentView {
  membershipId: string;
  consent: RoleAssignmentConsent;
  orgVisible: boolean;
}

export interface OfficerRoleView {
  roleId: string;
  officerKey: OfficerKey;
  name: string;
  emoji: string | null;
  color: RoleColor;
  requirement: OfficerRequirement;
  assignments: OfficerAssignmentView[];
}

export interface OfficerStatus {
  isRegisteredOrInFlight: boolean;
  outstanding: OutstandingOfficers;
  officers: OfficerRoleView[];
}

// A registration counts as "in flight or registered" for officer requirements
// unless it's absent (free camp) or has been withdrawn/rejected.
const IN_FLIGHT_STATUSES = new Set([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
]);

/**
 * The officer picture for a camp: which officers are required/recommended (from
 * its registration triggers), who is assigned to each (with consent), and the
 * outstanding-required count. Free/unregistered camps get `applies=false`.
 */
export async function getOfficerStatus(
  groupId: string,
  editionId: string,
): Promise<OfficerStatus> {
  const reg = await db()
    .select({
      status: schema.registrations.status,
      sound: schema.registrations.s5AmplifiedMusic,
    })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  const registration = reg[0];
  const isRegisteredOrInFlight = registration
    ? IN_FLIGHT_STATUSES.has(registration.status)
    : false;

  const triggers = {
    soundLevel: soundLevelFromValue(registration?.sound),
    // No dedicated generator/open-flame/fuel columns exist in the frozen
    // registration schema, so these default false; the pure trigger logic still
    // supports them for when those fields land.
    hasGenerators: false,
    hasOpenFlame: false,
    hasFuelStorage: false,
  };
  const requirements = officerRequirements(triggers);

  const roles = (await listRoles(groupId)).filter(
    (r) => r.kind === "officer" && r.officerKey !== null,
  );
  const assignments = await getRoleAssignments(groupId);
  const byRole = new Map<string, OfficerAssignmentView[]>();
  for (const [membershipId, list] of assignments) {
    for (const a of list) {
      const arr = byRole.get(a.projectRoleId) ?? [];
      arr.push({ membershipId, consent: a.consent, orgVisible: a.orgVisible });
      byRole.set(a.projectRoleId, arr);
    }
  }

  const officers: OfficerRoleView[] = roles.map((r) => {
    const key = r.officerKey as OfficerKey;
    return {
      roleId: r.id,
      officerKey: key,
      name: r.name,
      emoji: r.emoji,
      color: r.color,
      requirement: requirements.get(key) ?? "recommended",
      assignments: byRole.get(r.id) ?? [],
    };
  });

  const assignedKeys = officers
    .filter((o) => o.assignments.some((a) => officerSlotFilled(a.consent)))
    .map((o) => o.officerKey);

  const outstanding = outstandingOfficers({
    isRegisteredOrInFlight,
    triggers,
    assignedKeys,
  });

  return { isRegisteredOrInFlight, outstanding, officers };
}

/** Membership ids in a group that hold ANY of the given role ids (ACCEPTED). */
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
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
        inArray(schema.memberRoleAssignments.projectRoleId, [...roleIds]),
      ),
    );
  return [...new Set(rows.map((r) => r.membershipId))];
}

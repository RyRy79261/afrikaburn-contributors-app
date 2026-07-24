"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  InviteKind,
  PROJECT_ADMIN_ROLES,
  ProjectPermissions,
  RoleColor,
  type ProjectPermissionKey,
} from "@quagga/types";
import { hasProjectPermission } from "@quagga/core";
import { requireCampUser } from "@/lib/session";
import { getViewerRole, leaveCamp } from "@/lib/groups-store";
import {
  createInvite,
  revokeInvite,
  type InviteRow,
} from "@/lib/invites-store";
import {
  createRole,
  removeRole,
  renameRole,
  setMemberRoles,
  setRoleAppearance,
  setRolePermissions,
  assignOfficer,
  unassignOfficer,
  respondToOfficer,
  getMemberPermissions,
  type RoleMutationResult,
} from "@/lib/roles-store";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

async function groupIdForSlug(slug: string): Promise<string | null> {
  const rows = await db()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve the slug to a group and confirm the caller holds a given project
 * permission (lead/admin always pass via the backstop). The single authz gate
 * the role/officer actions share (questionnaire-spec §"Roles v2" CRUD).
 */
async function requirePermission(
  slug: string,
  permission: ProjectPermissionKey,
): Promise<
  | { ok: true; groupId: string; userId: string }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const groupId = await groupIdForSlug(slug);
  if (!groupId) return { ok: false, error: "Camp not found." };
  const membership = await getMemberPermissions(groupId, user.id);
  if (!membership || !hasProjectPermission(membership, permission)) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  return { ok: true, groupId, userId: user.id };
}

const CreateInviteInput = z.object({
  slug: z.string().min(1),
  kind: InviteKind,
});

export type CreateInviteResult =
  | { ok: true; invite: InviteRow }
  | { ok: false; error: string };

/** Mint a one-time invite (lead/admin only). */
export async function createInviteAction(
  raw: unknown,
): Promise<CreateInviteResult> {
  const parsed = CreateInviteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid invite request." };
  const user = await requireCampUser();
  const groupId = await groupIdForSlug(parsed.data.slug);
  if (!groupId) return { ok: false, error: "Camp not found." };
  const role = await getViewerRole(user.id, groupId);
  if (!role || !PROJECT_ADMIN_ROLES.includes(role)) {
    return { ok: false, error: "Only a camp lead can create invites." };
  }
  // A lead-transfer is a lead-only action (an admin can't hand over the lead).
  if (parsed.data.kind === "lead_transfer" && role !== "lead") {
    return { ok: false, error: "Only the current lead can transfer the lead role." };
  }
  const invite = await createInvite({
    groupId,
    createdByUserId: user.id,
    kind: parsed.data.kind,
  });
  revalidatePath(`/camps/${parsed.data.slug}`);
  return { ok: true, invite };
}

const RevokeInviteInput = z.object({
  slug: z.string().min(1),
  inviteId: z.string().uuid(),
});

export async function revokeInviteAction(
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = RevokeInviteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await requireCampUser();
  const groupId = await groupIdForSlug(parsed.data.slug);
  if (!groupId) return { ok: false, error: "Camp not found." };
  const role = await getViewerRole(user.id, groupId);
  if (!role || !PROJECT_ADMIN_ROLES.includes(role)) {
    return { ok: false, error: "Only a camp lead can revoke invites." };
  }
  await revokeInvite(parsed.data.inviteId, groupId);
  revalidatePath(`/camps/${parsed.data.slug}`);
  return { ok: true };
}

const LeaveInput = z.object({ slug: z.string().min(1) });

export async function leaveCampAction(
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = LeaveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await requireCampUser();
  const groupId = await groupIdForSlug(parsed.data.slug);
  if (!groupId) return { ok: false, error: "Camp not found." };
  const result = await leaveCamp(user.id, groupId);
  if (result.ok) revalidatePath(`/camps/${parsed.data.slug}`);
  return result;
}

// --- Custom project roles (questionnaire-spec §"Custom project roles") ----

const CreateRoleInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(60),
});

export async function createRoleAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = CreateRoleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid role name." };
  const gate = await requirePermission(parsed.data.slug, "manage_roles");
  if (!gate.ok) return gate;
  const result = await createRole(gate.groupId, parsed.data.name);
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

/** Revalidate both the dashboard and the roles settings page after a change. */
function revalidateRolePaths(slug: string): void {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/settings/roles`);
}

const RenameRoleInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
  name: z.string().min(1).max(60),
});

export async function renameRoleAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = RenameRoleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "manage_roles");
  if (!gate.ok) return gate;
  const result = await renameRole(gate.groupId, parsed.data.roleId, parsed.data.name);
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

const RemoveRoleInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
});

export async function removeRoleAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = RemoveRoleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "manage_roles");
  if (!gate.ok) return gate;
  const result = await removeRole(gate.groupId, parsed.data.roleId);
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

const SetMemberRolesInput = z.object({
  slug: z.string().min(1),
  membershipId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()),
});

export async function setMemberRolesAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = SetMemberRolesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "assign_roles");
  if (!gate.ok) return gate;
  // Escalation guard: assigning an elevating role (manage_roles/manage_members
  // or Captain) requires manage_roles — assign_roles alone is strictly weaker.
  const membership = await getMemberPermissions(gate.groupId, gate.userId);
  const allowElevated =
    !!membership && hasProjectPermission(membership, "manage_roles");
  const result = await setMemberRoles(
    gate.groupId,
    parsed.data.membershipId,
    parsed.data.roleIds,
    { allowElevated },
  );
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

// --- Roles v2: appearance, permissions, officer registrations -------------

const SetAppearanceInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
  color: RoleColor.optional(),
  emoji: z.string().max(8).nullable().optional(),
});

export async function setRoleAppearanceAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = SetAppearanceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "manage_roles");
  if (!gate.ok) return gate;
  const result = await setRoleAppearance(gate.groupId, parsed.data.roleId, {
    color: parsed.data.color,
    emoji: parsed.data.emoji,
  });
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

const SetPermissionsInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
  permissions: ProjectPermissions,
});

export async function setRolePermissionsAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = SetPermissionsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid permissions." };
  const gate = await requirePermission(parsed.data.slug, "manage_roles");
  if (!gate.ok) return gate;
  const result = await setRolePermissions(
    gate.groupId,
    parsed.data.roleId,
    parsed.data.permissions,
  );
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

const OfficerAssignInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export async function assignOfficerAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = OfficerAssignInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "assign_roles");
  if (!gate.ok) return gate;
  const result = await assignOfficer(
    gate.groupId,
    parsed.data.membershipId,
    parsed.data.roleId,
  );
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

export async function unassignOfficerAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = OfficerAssignInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const gate = await requirePermission(parsed.data.slug, "assign_roles");
  if (!gate.ok) return gate;
  const result = await unassignOfficer(
    gate.groupId,
    parsed.data.membershipId,
    parsed.data.roleId,
  );
  if (result.ok) revalidateRolePaths(parsed.data.slug);
  return result;
}

const OfficerRespondInput = z.object({
  slug: z.string().min(1),
  roleId: z.string().uuid(),
  accept: z.boolean(),
});

/**
 * A member's own response to an officer registration (accept shares contact with
 * the org; decline frees the slot). No management permission required — the
 * actor is consenting on their own behalf, gated only by camp membership.
 */
export async function respondToOfficerAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = OfficerRespondInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const user = await requireCampUser();
  const groupId = await groupIdForSlug(parsed.data.slug);
  if (!groupId) return { ok: false, error: "Camp not found." };
  const result = await respondToOfficer(
    user.id,
    groupId,
    parsed.data.roleId,
    parsed.data.accept,
  );
  if (result.ok) {
    revalidateRolePaths(parsed.data.slug);
    revalidatePath("/", "layout");
  }
  return result;
}

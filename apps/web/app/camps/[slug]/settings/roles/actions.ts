"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ProjectPermissions, RoleColor } from "@quagga/types";
import { hasProjectPermission, normalizeRoleName } from "@quagga/core";
import { requireCampUser } from "@/lib/session";
import {
  createRole,
  getMemberPermissions,
  listRoles,
  setRolePermissions,
  type RoleMutationResult,
} from "@/lib/roles-store";
import { db, schema } from "@/lib/db";

// Create-with-setup for the Roles & Officers settings screen. The canvas "New
// role" card captures name + icon + colour + privileges in one go, so this
// action does the whole thing atomically from the caller's point of view. Authz
// is the same server-side gate the sibling role actions use — `manage_roles`,
// with lead/admin passing via the irrevocable structural backstop. UI state is
// never the boundary.

const CreateRoleWithSetupInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(60),
  color: RoleColor.optional(),
  emoji: z.string().max(8).nullable().optional(),
  permissions: ProjectPermissions.optional(),
});

export async function createRoleWithSetupAction(
  raw: unknown,
): Promise<RoleMutationResult> {
  const parsed = CreateRoleWithSetupInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid role." };
  const { slug, name, color, emoji, permissions } = parsed.data;

  const user = await requireCampUser();
  const groups = await db()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  const groupId = groups[0]?.id;
  if (!groupId) return { ok: false, error: "Camp not found." };

  const membership = await getMemberPermissions(groupId, user.id);
  if (!membership || !hasProjectPermission(membership, "manage_roles")) {
    return { ok: false, error: "You don't have permission to do that." };
  }

  const created = await createRole(groupId, name, { color, emoji });
  if (!created.ok) return created;

  if (permissions && Object.keys(permissions).length > 0) {
    const key = normalizeRoleName(name);
    const role = (await listRoles(groupId)).find(
      (r) => normalizeRoleName(r.name) === key,
    );
    // `setRolePermissions` re-applies `enforceKindPermissions` for the kind.
    if (role) await setRolePermissions(groupId, role.id, permissions);
  }

  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/settings/roles`);
  return { ok: true };
}

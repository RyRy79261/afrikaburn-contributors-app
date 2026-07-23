"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { InviteKind, PROJECT_ADMIN_ROLES } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getViewerRole, leaveCamp } from "@/lib/groups-store";
import {
  createInvite,
  revokeInvite,
  type InviteRow,
} from "@/lib/invites-store";
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

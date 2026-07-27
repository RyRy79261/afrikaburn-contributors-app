"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAuthorProjectQuestionnaire } from "@quagga/core";
import { Questionnaire, type ProjectAudience } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { createAndActivateProjectQuestionnaire } from "@/lib/questionnaire-store";
import { getBaselineRoleId, getMemberPermissions } from "@/lib/roles-store";
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

// Boundary schema (Zod at every action). The definition is validated against
// the shared `Questionnaire` shape, so "at least one page with one question" is
// enforced here, not just in the UI.
const CreateInput = z.object({
  slug: z.string().min(1),
  title: z.string().min(1).max(140),
  description: z.string().max(2000).optional(),
  definition: Questionnaire,
  mode: z.enum(["everyone", "roles"]),
  roleIds: z.array(z.string().uuid()).default([]),
  blocking: z.boolean(),
  dueAt: z.string().min(1).nullable().default(null),
});

export type CreateQuestionnaireResult =
  | { ok: true; activationId: string; sent: number; emailDelivered: boolean }
  | { ok: false; error: string };

/**
 * Create a project questionnaire and send it (build + activate in one step,
 * questionnaire-spec §Surfaces). Lead/admin only — authorised through the core
 * `canAuthorAudience` predicate against the actor's membership.
 */
export async function createQuestionnaireAction(
  raw: unknown,
): Promise<CreateQuestionnaireResult> {
  const parsed = CreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Please complete the questionnaire before sending." };
  }
  const { slug, title, description, definition, mode, roleIds, blocking } =
    parsed.data;

  const user = await requireCampUser();
  const groupId = await groupIdForSlug(slug);
  if (!groupId) return { ok: false, error: "Camp not found." };

  const audience: ProjectAudience = {
    kind: "project",
    groupId,
    mode,
    roleIds: mode === "roles" ? roleIds : [],
  };

  if (mode === "roles" && roleIds.length === 0) {
    return { ok: false, error: "Pick at least one role, or send to everyone." };
  }

  // Authz + scope: lead/admin OR a member holding manage_questionnaires WITHIN
  // their configured audience_roles + may_block scope (questionnaire-spec
  // §"Roles v2" — server-side enforcement).
  const permissionMembership = await getMemberPermissions(groupId, user.id);
  if (!permissionMembership) {
    return { ok: false, error: "You're not a member of this camp." };
  }
  const baselineRoleId = await getBaselineRoleId(groupId);
  if (
    !canAuthorProjectQuestionnaire(
      permissionMembership,
      audience,
      blocking,
      baselineRoleId,
    )
  ) {
    return {
      ok: false,
      error: "You can't send to that audience — check your questionnaire permissions.",
    };
  }

  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  let dueAt: Date | null = null;
  if (parsed.data.dueAt) {
    const t = Date.parse(parsed.data.dueAt);
    if (Number.isNaN(t)) return { ok: false, error: "That due date isn't valid." };
    dueAt = new Date(t);
  }

  const result = await createAndActivateProjectQuestionnaire({
    groupId,
    editionId: edition.id,
    createdByUserId: user.id,
    title,
    description: description ?? null,
    definition,
    audience,
    blocking,
    dueAt,
  });

  revalidatePath(`/camps/${slug}/questionnaires`);
  return {
    ok: true,
    activationId: result.activationId,
    sent: result.sent,
    emailDelivered: result.emailDelivered,
  };
}

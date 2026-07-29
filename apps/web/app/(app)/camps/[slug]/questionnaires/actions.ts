"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAuthorProjectQuestionnaire } from "@quagga/core";
import { Questionnaire, type ProjectAudience } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { createAndActivateProjectQuestionnaire } from "@/lib/questionnaire-store";
import { getBaselineRoleId, getMemberPermissions } from "@/lib/roles-store";
import { db, schema, withTransaction } from "@/lib/db";
import { and, eq } from "drizzle-orm";

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

const CloseInput = z.object({
  slug: z.string().min(1),
  activationId: z.string().uuid(),
});

export type CloseQuestionnaireResult =
  { ok: true } | { ok: false; error: string };

/**
 * Close (recall) a camp questionnaire. The console has had this for org sends
 * since it shipped; camp sends had NO way back at all — a questionnaire sent to
 * the wrong roles, or one made BLOCKING by mistake, kept hard-gating the app of
 * every member it reached, with no control anywhere in the camp UI to stop it.
 *
 * Closing does two things, in one transaction because half of it is worse than
 * neither:
 *   1. the activation goes `closed` — it stops reading as live in the list;
 *   2. every still-PENDING `required_actions` row for it becomes `expired`.
 * (2) is the part that makes this a recall rather than a label: the participant
 * gate (`firstBlockingAction`) and the pending-questionnaires list both key off
 * `status === "pending"`, so without it a "closed" blocking questionnaire would
 * carry on locking people out of the app.
 *
 * COMPLETED rows are left exactly as they are: answers already given stay, and
 * the results view keeps showing them.
 */
export async function closeQuestionnaireAction(
  raw: unknown,
): Promise<CloseQuestionnaireResult> {
  const parsed = CloseInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That questionnaire isn't one we recognise." };
  }
  const { slug, activationId } = parsed.data;

  const user = await requireCampUser();
  const groupId = await groupIdForSlug(slug);
  if (!groupId) return { ok: false, error: "Camp not found." };

  const rows = await db()
    .select({
      status: schema.questionnaireActivations.status,
      authoredScope: schema.questionnaireActivations.authoredScope,
      groupId: schema.questionnaireActivations.groupId,
      audience: schema.questionnaireActivations.audience,
      blocking: schema.questionnaireActivations.blocking,
    })
    .from(schema.questionnaireActivations)
    .where(eq(schema.questionnaireActivations.id, activationId))
    .limit(1);
  const activation = rows[0];
  // Never let one camp close another camp's — or the org's — questionnaire.
  if (
    !activation ||
    activation.authoredScope !== "group" ||
    activation.groupId !== groupId ||
    activation.audience?.kind !== "project"
  ) {
    return { ok: false, error: "That questionnaire isn't this camp's." };
  }

  // You may recall what you could have sent: the same scope check the send ran,
  // against the audience this one actually went to.
  const permissionMembership = await getMemberPermissions(groupId, user.id);
  if (!permissionMembership) {
    return { ok: false, error: "You're not a member of this camp." };
  }
  const baselineRoleId = await getBaselineRoleId(groupId);
  if (
    !canAuthorProjectQuestionnaire(
      permissionMembership,
      activation.audience,
      activation.blocking,
      baselineRoleId,
    )
  ) {
    return {
      ok: false,
      error:
        "This one went to an audience your questionnaire permissions don't cover — ask a lead or admin to close it.",
    };
  }

  // Idempotent: closing an already-closed one is a no-op, not an error, so a
  // double-click or a stale page can't produce a scary message.
  if (activation.status !== "closed") {
    const now = new Date();
    await withTransaction(async (tx) => {
      await tx
        .update(schema.questionnaireActivations)
        .set({ status: "closed", closedAt: now, updatedAt: now })
        .where(eq(schema.questionnaireActivations.id, activationId));

      await tx
        .update(schema.requiredActions)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.requiredActions.activationId, activationId),
            eq(schema.requiredActions.status, "pending"),
          ),
        );
    });
  }

  revalidatePath(`/camps/${slug}/questionnaires`);
  return { ok: true };
}

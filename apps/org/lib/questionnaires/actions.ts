"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  buildActivationRequiredActions,
  canActivateAudience,
  canAuthorAudience,
  completeRequiredAction as completeRequiredActionPatch,
  resolveAudience,
  type AuthzMembership,
} from "@quagga/core";
import {
  AudienceSpec,
  QuestionnaireActivationInput,
  QuestionnaireBuilderInput,
  authoredScopeForAudience,
  groupIdForAudience,
  validateResponses,
  type Questionnaire,
  type SaveResult,
} from "@quagga/types";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession, type OrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { buildAudienceContext } from "@/lib/questionnaires/queries";
import { runAction, type ActionResult } from "@/lib/actions/result";

/** The console actor's memberships for the core authz predicates: a single org
 * membership carrying their org role. Custom roles are never permissions. */
function authzMemberships(session: OrgSession): AuthzMembership[] {
  return [{ groupId: session.orgGroupId, role: session.role }];
}

/** Slugify a title into a stable, org-namespaced definition key candidate. */
function slugifyKey(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `org-${slug || "questionnaire"}`;
}

/** Find an unused definition key from a base candidate (base, base-2, …). */
async function uniqueDefinitionKey(base: string): Promise<string> {
  const db = getDb();
  for (let i = 0; i < 200; i++) {
    const key = i === 0 ? base : `${base}-${i + 1}`;
    const [existing] = await db
      .select({ key: schema.questionnaireDefinitions.key })
      .from(schema.questionnaireDefinitions)
      .where(eq(schema.questionnaireDefinitions.key, key))
      .limit(1);
    if (!existing) return key;
  }
  throw new Error("Could not allocate a questionnaire key.");
}

/** Overwrite the definition's version + sync its first page title/subtitle to the
 * builder's title/description so the two representations never drift. */
function normalizeDefinition(
  definition: Questionnaire,
  version: string,
  title: string,
  description: string | undefined,
): Questionnaire {
  return {
    ...definition,
    version,
    pages: definition.pages.map((page, index) =>
      page.kind === "questions" && index === 0
        ? { ...page, title, subtitle: description || undefined }
        : page,
    ),
  };
}

export type SaveDefinitionResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

/**
 * Create or update an org questionnaire definition. Org authors only (server-
 * checked). Create allocates an `org-` namespaced key + version "1"; edit bumps
 * the version. The definition is stored versioned as jsonb.
 */
export async function saveQuestionnaireDefinition(
  raw: z.input<typeof QuestionnaireBuilderInput>,
): Promise<SaveDefinitionResult> {
  try {
    const session = await requireOrgSession();
    const input = QuestionnaireBuilderInput.parse(raw);

    // Author gate: org_internal spec stands in for "org author" here.
    if (!canAuthorAudience(authzMemberships(session), { kind: "org_internal" }, session.orgGroupId)) {
      throw new Error("You are not allowed to author org questionnaires.");
    }

    const db = getDb();

    if (input.key) {
      // Edit an existing org-owned definition.
      if (!input.key.startsWith("org-")) {
        throw new Error("That questionnaire is not editable in the console.");
      }
      const [current] = await db
        .select({ version: schema.questionnaireDefinitions.version })
        .from(schema.questionnaireDefinitions)
        .where(eq(schema.questionnaireDefinitions.key, input.key))
        .limit(1);
      if (!current) throw new Error("That questionnaire no longer exists.");

      const nextVersion = String((Number(current.version) || 0) + 1);
      const definition = normalizeDefinition(
        input.definition,
        nextVersion,
        input.title,
        input.description,
      );

      await db
        .update(schema.questionnaireDefinitions)
        .set({
          title: input.title,
          definition,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(schema.questionnaireDefinitions.key, input.key));

      await writeAuditEvent(db, {
        actorId: session.dbUserId,
        action: "questionnaire.definition.update",
        subject: input.key,
        meta: { version: nextVersion },
      });

      revalidatePath("/questionnaires");
      revalidatePath(`/questionnaires/${input.key}/edit`);
      return { ok: true, key: input.key };
    }

    // Create.
    const key = await uniqueDefinitionKey(slugifyKey(input.title));
    const definition = normalizeDefinition(
      input.definition,
      "1",
      input.title,
      input.description,
    );

    await db.insert(schema.questionnaireDefinitions).values({
      key,
      title: input.title,
      definition,
      status: "published",
      version: "1",
      createdByUserId: session.dbUserId,
    });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "questionnaire.definition.create",
      subject: key,
      meta: { title: input.title },
    });

    revalidatePath("/questionnaires");
    return { ok: true, key };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not save the questionnaire. Try again.",
    };
  }
}

const PreviewInput = z.object({
  audience: AudienceSpec,
  editionId: z.string().uuid(),
});

export type PreviewResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * LIVE resolved-audience count for the activation flow: authz-check the actor,
 * load the edition's row sets, and run the pure `resolveAudience`. Returns the
 * number of users who would receive the questionnaire right now.
 */
export async function previewAudienceCount(
  raw: z.input<typeof PreviewInput>,
): Promise<PreviewResult> {
  try {
    const session = await requireOrgSession();
    const input = PreviewInput.parse(raw);

    if (input.audience.kind === "project") {
      throw new Error("Project audiences are authored from the camp dashboard.");
    }
    if (
      !canActivateAudience(
        authzMemberships(session),
        input.audience,
        session.orgGroupId,
      )
    ) {
      throw new Error("You are not allowed to target that audience.");
    }

    const ctx = await buildAudienceContext(input.editionId, session.orgGroupId);
    const userIds = resolveAudience(input.audience, ctx);
    return { ok: true, count: userIds.length };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not resolve the audience.",
    };
  }
}

/**
 * Activate a definition against an edition + audience. Resolves the audience at
 * send time into `required_actions` rows (one per targeted user), writes the
 * activation row, and audits. Org authors + org audiences only.
 */
export async function activateQuestionnaire(
  raw: z.input<typeof QuestionnaireActivationInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = QuestionnaireActivationInput.parse(raw);

    if (input.audience.kind === "project") {
      throw new Error("Project audiences are authored from the camp dashboard.");
    }
    if (
      !canActivateAudience(
        authzMemberships(session),
        input.audience,
        session.orgGroupId,
      )
    ) {
      throw new Error("You are not allowed to send to that audience.");
    }

    const db = getDb();

    // Confirm the definition exists and is org-owned.
    const [def] = await db
      .select({
        key: schema.questionnaireDefinitions.key,
        version: schema.questionnaireDefinitions.version,
      })
      .from(schema.questionnaireDefinitions)
      .where(eq(schema.questionnaireDefinitions.key, input.questionnaireKey))
      .limit(1);
    if (!def) throw new Error("That questionnaire no longer exists.");
    if (!def.key.startsWith("org-")) {
      throw new Error("That questionnaire cannot be sent from the console.");
    }

    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new Error("The due date is not a valid date.");
    }

    // Resolve the audience at send time.
    const ctx = await buildAudienceContext(input.editionId, session.orgGroupId);
    const userIds = resolveAudience(input.audience, ctx);

    const now = new Date();
    const [activation] = await db
      .insert(schema.questionnaireActivations)
      .values({
        questionnaireKey: def.key,
        version: def.version ?? input.version,
        title: input.title,
        description: input.description ?? null,
        blocking: input.blocking,
        status: "open",
        dueAt,
        authoredScope: authoredScopeForAudience(input.audience),
        groupId: groupIdForAudience(input.audience),
        editionId: input.editionId,
        audience: input.audience,
        activatedByUserId: session.dbUserId,
        openedAt: now,
      })
      .returning({ id: schema.questionnaireActivations.id });
    if (!activation) throw new Error("Could not create the activation.");

    // Fan out required_actions (idempotent on user + action_key).
    const rows = buildActivationRequiredActions(
      {
        id: activation.id,
        title: input.title,
        blocking: input.blocking,
        dueAt,
      },
      userIds,
    );
    if (rows.length > 0) {
      await db
        .insert(schema.requiredActions)
        .values(
          rows.map((r) => ({
            userId: r.userId,
            type: r.type,
            actionKey: r.actionKey,
            version: def.version ?? input.version,
            activationId: activation.id,
            title: r.title,
            blocking: r.blocking,
            status: r.status,
            dueAt: r.dueAt,
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.requiredActions.userId,
            schema.requiredActions.actionKey,
          ],
        });
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "questionnaire.activate",
      subject: activation.id,
      meta: {
        questionnaireKey: def.key,
        audience: input.audience,
        blocking: input.blocking,
        recipients: userIds.length,
        editionId: input.editionId,
      },
    });

    revalidatePath("/questionnaires");
    revalidatePath(`/questionnaires/${def.key}/activate`);
  });
}

const CloseInput = z.object({ activationId: z.string().uuid() });

/** Close an open activation (stops it appearing as active; results stay). */
export async function closeActivation(
  raw: z.input<typeof CloseInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = CloseInput.parse(raw);
    const db = getDb();

    const [a] = await db
      .select({ authoredScope: schema.questionnaireActivations.authoredScope })
      .from(schema.questionnaireActivations)
      .where(eq(schema.questionnaireActivations.id, input.activationId))
      .limit(1);
    if (!a || a.authoredScope !== "org") {
      throw new Error("That activation is not managed by the console.");
    }

    await db
      .update(schema.questionnaireActivations)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.questionnaireActivations.id, input.activationId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "questionnaire.close",
      subject: input.activationId,
    });

    revalidatePath("/questionnaires");
    revalidatePath(`/questionnaires`);
  });
}

/**
 * Submit the current console user's answers to an org-INTERNAL blocking
 * questionnaire (the console gate). Validates against the definition, upserts the
 * response, and flips the required_action to completed — unlocking the console.
 */
export async function submitConsoleQuestionnaire(
  activationId: string,
  rawResponses: unknown,
): Promise<SaveResult> {
  try {
    const session = await requireOrgSession();
    const parsedId = z.string().uuid().safeParse(activationId);
    if (!parsedId.success) {
      return { ok: false, errors: { _form: "Unknown questionnaire." } };
    }

    const db = getDb();
    const [activation] = await db
      .select({
        id: schema.questionnaireActivations.id,
        key: schema.questionnaireActivations.questionnaireKey,
        version: schema.questionnaireActivations.version,
        audience: schema.questionnaireActivations.audience,
      })
      .from(schema.questionnaireActivations)
      .where(eq(schema.questionnaireActivations.id, parsedId.data))
      .limit(1);
    if (!activation) {
      return { ok: false, errors: { _form: "This questionnaire has ended." } };
    }
    const spec = (activation.audience ?? null) as AudienceSpec | null;
    if (spec?.kind !== "org_internal") {
      return {
        ok: false,
        errors: { _form: "This questionnaire can't be answered here." },
      };
    }

    const [def] = await db
      .select({ definition: schema.questionnaireDefinitions.definition })
      .from(schema.questionnaireDefinitions)
      .where(eq(schema.questionnaireDefinitions.key, activation.key))
      .limit(1);
    if (!def) {
      return { ok: false, errors: { _form: "This questionnaire has ended." } };
    }

    const validated = validateResponses(def.definition, rawResponses);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const now = new Date();
    await db
      .insert(schema.questionnaireResponses)
      .values({
        userId: session.dbUserId,
        definitionKey: activation.key,
        definitionVersion: activation.version,
        responses: validated.responses,
        activationId: activation.id,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.questionnaireResponses.userId,
          schema.questionnaireResponses.definitionKey,
        ],
        set: {
          responses: validated.responses,
          definitionVersion: activation.version,
          activationId: activation.id,
          completedAt: now,
          updatedAt: now,
        },
      });

    const patch = completeRequiredActionPatch(now);
    await db
      .update(schema.requiredActions)
      .set({ status: patch.status, completedAt: patch.completedAt })
      .where(
        and(
          eq(schema.requiredActions.userId, session.dbUserId),
          eq(schema.requiredActions.activationId, activation.id),
        ),
      );

    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return {
      ok: false,
      errors: { _form: "We couldn't save your answers. Try again." },
    };
  }
}

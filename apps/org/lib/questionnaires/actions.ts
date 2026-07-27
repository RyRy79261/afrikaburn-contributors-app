"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  buildActivationRequiredActions,
  canActivateAudience,
  canAuthorAudience,
  completeRequiredAction as completeRequiredActionPatch,
  ORG_RANK_LABELS,
  questionnaireReleasedNotification,
  resolveActivationDefinition,
  resolveAudience,
  shouldSendImmediateEmail,
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

import { getDb, schema, withTransaction } from "@/lib/db";
import { getActiveEdition } from "@/lib/queries";
import { requireOrgSession, type OrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { buildAudienceContext } from "@/lib/questionnaires/queries";
import { runAction, type ActionResult } from "@/lib/actions/result";
import { inArray } from "drizzle-orm";

/** The console actor's memberships for the core authz predicates: a single org
 * membership carrying their org rank. Custom roles are never permissions. */
function authzMemberships(session: OrgSession): AuthzMembership[] {
  return [{ groupId: session.orgGroupId, role: session.role }];
}

/**
 * The refusal an actor gets from the AUTHORING gate, named to their rank.
 *
 * `canAuthorAudience` admits org authors only (god / org_staff), which is what
 * keeps an ENGINEER out of questionnaires: the rank holds `write` for console
 * operations, but authoring and sending questionnaires to burners in
 * AfrikaBurn's name is not IT work, and their answers are personal information
 * the rank may not read in the first place — sending a form whose replies you
 * are not allowed to open is not a permission worth having.
 */
function authoringRefusal(session: OrgSession, verb: string): string {
  return session.role === "engineer"
    ? `${ORG_RANK_LABELS.engineer} accounts don't ${verb} questionnaires — their answers are personal information. Ask org staff.`
    : `You are not allowed to ${verb} that questionnaire.`;
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
  { ok: true; key: string } | { ok: false; error: string };

/**
 * Create or update an org questionnaire definition. Org authors only (server-
 * checked). Create allocates an `org-` namespaced key + version "1"; edit bumps
 * the version. The definition is stored versioned as jsonb.
 */
export async function saveQuestionnaireDefinition(
  raw: z.input<typeof QuestionnaireBuilderInput>,
): Promise<SaveDefinitionResult> {
  try {
    const session = await requireOrgSession({ capability: "write" });
    const input = QuestionnaireBuilderInput.parse(raw);

    // Author gate: org_internal spec stands in for "org author" here.
    if (
      !canAuthorAudience(
        authzMemberships(session),
        { kind: "org_internal" },
        session.orgGroupId,
      )
    ) {
      throw new Error(authoringRefusal(session, "author"));
    }

    if (input.key) {
      // Edit an existing org-owned definition.
      if (!input.key.startsWith("org-")) {
        throw new Error("That questionnaire is not editable in the console.");
      }
      const editKey = input.key;
      // Version read, definition update and audit are one atomic unit.
      await withTransaction(async (tx) => {
        const [current] = await tx
          .select({ version: schema.questionnaireDefinitions.version })
          .from(schema.questionnaireDefinitions)
          .where(eq(schema.questionnaireDefinitions.key, editKey))
          .limit(1);
        if (!current) throw new Error("That questionnaire no longer exists.");

        const nextVersion = String((Number(current.version) || 0) + 1);
        const definition = normalizeDefinition(
          input.definition,
          nextVersion,
          input.title,
          input.description,
        );

        await tx
          .update(schema.questionnaireDefinitions)
          .set({
            title: input.title,
            definition,
            version: nextVersion,
            updatedAt: new Date(),
          })
          .where(eq(schema.questionnaireDefinitions.key, editKey));

        await writeAuditEvent(tx, {
          actorId: session.dbUserId,
          action: "questionnaire.definition.update",
          subject: editKey,
          meta: { version: nextVersion },
        });
      });

      revalidatePath("/questionnaires");
      revalidatePath(`/questionnaires/${editKey}/edit`);
      return { ok: true, key: editKey };
    }

    // Create.
    const key = await uniqueDefinitionKey(slugifyKey(input.title));
    const definition = normalizeDefinition(
      input.definition,
      "1",
      input.title,
      input.description,
    );

    // Definition insert and audit are one atomic unit.
    await withTransaction(async (tx) => {
      await tx.insert(schema.questionnaireDefinitions).values({
        key,
        title: input.title,
        definition,
        status: "published",
        version: "1",
        createdByUserId: session.dbUserId,
      });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "questionnaire.definition.create",
        subject: key,
        meta: { title: input.title },
      });
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
  { ok: true; count: number } | { ok: false; error: string };

/**
 * LIVE resolved-audience count for the activation flow: authz-check the actor,
 * load the edition's row sets, and run the pure `resolveAudience`. Returns the
 * number of users who would receive the questionnaire right now.
 */
export async function previewAudienceCount(
  raw: z.input<typeof PreviewInput>,
): Promise<PreviewResult> {
  try {
    const session = await requireOrgSession({ capability: "write" });
    const input = PreviewInput.parse(raw);

    if (input.audience.kind === "project") {
      throw new Error(
        "Project audiences are authored from the camp dashboard.",
      );
    }
    if (
      !canActivateAudience(
        authzMemberships(session),
        input.audience,
        session.orgGroupId,
      )
    ) {
      throw new Error(authoringRefusal(session, "send"));
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
    const session = await requireOrgSession({ capability: "write" });
    const input = QuestionnaireActivationInput.parse(raw);

    if (input.audience.kind === "project") {
      throw new Error(
        "Project audiences are authored from the camp dashboard.",
      );
    }
    if (
      !canActivateAudience(
        authzMemberships(session),
        input.audience,
        session.orgGroupId,
      )
    ) {
      throw new Error(authoringRefusal(session, "send"));
    }

    const db = getDb();

    // Confirm the definition exists and is org-owned.
    const [def] = await db
      .select({
        key: schema.questionnaireDefinitions.key,
        version: schema.questionnaireDefinitions.version,
        definition: schema.questionnaireDefinitions.definition,
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

    // Resolve the audience at send time (read — kept OUTSIDE the transaction so
    // the write transaction stays short).
    const ctx = await buildAudienceContext(input.editionId, session.orgGroupId);
    const userIds = resolveAudience(input.audience, ctx);

    const now = new Date();

    // The activation row, its fanned-out required_actions and the audit row are
    // one atomic unit — an activation must never exist without the required
    // actions that make it reach its audience, and neither without the audit
    // trail. A partial send would either strand recipients or gate them.
    const activationId = await withTransaction(async (tx) => {
      const [activation] = await tx
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
          // Snapshot the definition AS SENT — the activation must render/
          // validate/aggregate against exactly this, immune to later edits.
          definition: def.definition,
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
        await tx
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

      await writeAuditEvent(tx, {
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

      return activation.id;
    });

    // Event hook: notify the resolved audience that a questionnaire was
    // released (blocking flag surfaced), + immediate email for blocking ones.
    // Thin + best-effort, AFTER commit — never blocks or rolls back the send.
    if (userIds.length > 0) {
      try {
        const payload = questionnaireReleasedNotification({
          title: input.title,
          blocking: input.blocking,
          activationId,
        });
        await insertNotifications(
          db,
          userIds.map((userId) => ({ ...payload, userId })),
        );
        if (
          shouldSendImmediateEmail("questionnaire", {
            blocking: input.blocking,
          })
        ) {
          const recipients = await db
            .select({ email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, userIds));
          const to = recipients
            .map((r) => r.email)
            .filter((e): e is string => Boolean(e));
          if (to.length > 0) {
            await sendEmail({
              to,
              subject: payload.title,
              text: `${payload.title}\n\nOpen the Contributors app to complete it.`,
            });
          }
        }
      } catch (err) {
        console.error("[notifications] questionnaire release hook failed", err);
      }
    }

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
    const session = await requireOrgSession({ capability: "write" });
    const input = CloseInput.parse(raw);

    // Scope check, close and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [a] = await tx
        .select({
          authoredScope: schema.questionnaireActivations.authoredScope,
        })
        .from(schema.questionnaireActivations)
        .where(eq(schema.questionnaireActivations.id, input.activationId))
        .limit(1);
      if (!a || a.authoredScope !== "org") {
        throw new Error("That activation is not managed by the console.");
      }

      await tx
        .update(schema.questionnaireActivations)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.questionnaireActivations.id, input.activationId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "questionnaire.close",
        subject: input.activationId,
      });
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
    // Answering YOUR OWN blocking questionnaire is not an authoring act — every
    // rank must be able to clear their own console gate.
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
        definition: schema.questionnaireActivations.definition,
        editionId: schema.questionnaireActivations.editionId,
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

    // Validate against the SNAPSHOT (what this respondent was sent); fall back to
    // the live definition only for pre-snapshot activation rows.
    const definition = resolveActivationDefinition(
      activation.definition,
      def.definition,
    );
    const validated = validateResponses(definition, rawResponses);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    // Answers are scoped to the activation's edition (migration 0020). A
    // pre-feature activation has no edition, so fall back to the active one.
    const editionId =
      activation.editionId ?? (await getActiveEdition())?.id ?? null;
    if (!editionId) {
      return {
        ok: false,
        errors: { _form: "No AfrikaBurn edition is set up yet." },
      };
    }

    const now = new Date();
    // The response upsert and the required-action completion are one atomic
    // unit: a saved response that failed to flip the gate would lock the staff
    // member out of the console, and a flipped gate with no stored response
    // would lose their answers. Both, or neither.
    await withTransaction(async (tx) => {
      await tx
        .insert(schema.questionnaireResponses)
        .values({
          userId: session.dbUserId,
          definitionKey: activation.key,
          editionId,
          definitionVersion: activation.version,
          responses: validated.responses,
          activationId: activation.id,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.questionnaireResponses.userId,
            schema.questionnaireResponses.definitionKey,
            schema.questionnaireResponses.editionId,
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
      await tx
        .update(schema.requiredActions)
        .set({ status: patch.status, completedAt: patch.completedAt })
        .where(
          and(
            eq(schema.requiredActions.userId, session.dbUserId),
            eq(schema.requiredActions.activationId, activation.id),
          ),
        );
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return {
      ok: false,
      errors: { _form: "We couldn't save your answers. Try again." },
    };
  }
}

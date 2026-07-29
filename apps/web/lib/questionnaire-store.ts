import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  activationRequiredActionKey,
  buildActivationRequiredActions,
  isParticipantFacingActivation,
  parseActivationActionKey,
  publicMemberName,
  questionnaireReleasedNotification,
  resolveActivationDefinition,
  resolveAudience,
  tallyActivationCompletion,
  validateSubmission,
  type AudienceContext,
} from "@quagga/core";
import {
  flattenQuestions,
  type AudienceSpec,
  type OfficerKey,
  type ProjectAudience,
  type Questionnaire,
  type QuestionnaireResponses,
  type SaveResult,
} from "@quagga/types";
import { db, schema, withTransaction } from "./db";
import { completeRequiredAction } from "./required-actions";
import { sendEmail } from "./email";
import { getActiveEdition } from "./edition";
import { insertNotifications } from "./notifications";

// Persistence + activation service for the questionnaire builder
// (questionnaire-spec §"Engine mechanics"). Project questionnaires are stored
// in the shared `questionnaire_definitions`/`_activations`/`_responses` spine;
// a project definition is namespaced by its key so a camp's builder can list
// only its own. Audience resolution is delegated to @quagga/core's pure
// `resolveAudience`; this layer just loads the rows and performs the writes.

const DEFINITION_VERSION = "1";

/** Key prefix that scopes a definition to a project group. */
function projectDefinitionKey(groupId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `proj:${groupId}:${rand}`;
}

/** True when a definition key belongs to the given project group. */
export function isProjectDefinitionKey(key: string, groupId: string): boolean {
  return key.startsWith(`proj:${groupId}:`);
}

// --- Builder + activation (create & send, project scope) -----------------

export interface CreateProjectQuestionnaireInput {
  groupId: string;
  editionId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  definition: Questionnaire;
  audience: ProjectAudience;
  blocking: boolean;
  dueAt: Date | null;
}

export interface CreateProjectQuestionnaireResult {
  activationId: string;
  sent: number;
  emailDelivered: boolean;
}

/**
 * Create a project questionnaire definition and activate it in one step: write
 * the definition, resolve the audience (members + custom roles) to user ids,
 * insert one `required_actions` row per target, and email each target. Returns
 * the new activation id and how many were targeted.
 */
export async function createAndActivateProjectQuestionnaire(
  input: CreateProjectQuestionnaireInput,
): Promise<CreateProjectQuestionnaireResult> {
  const key = projectDefinitionKey(input.groupId);

  // The audience → user-id resolution is read-only and independent of the rows
  // we're about to write, so compute it before opening the transaction.
  const userIds = await resolveProjectTargets(
    input.groupId,
    input.editionId,
    input.audience,
  );

  // The definition, its activation, and the one required-action per target are
  // written as ONE transaction. Otherwise a failure after the definition (or
  // after the activation) leaves an orphan definition, or an activation nobody
  // was actually gated to complete — a questionnaire that silently reaches no
  // one. Email is a side effect and stays OUTSIDE the transaction (below).
  const activationId = await withTransaction(async (tx) => {
    await tx.insert(schema.questionnaireDefinitions).values({
      key,
      title: input.title,
      definition: input.definition,
      status: "published",
      version: DEFINITION_VERSION,
      createdByUserId: input.createdByUserId,
    });

    const inserted = await tx
      .insert(schema.questionnaireActivations)
      .values({
        questionnaireKey: key,
        version: DEFINITION_VERSION,
        title: input.title,
        description: input.description,
        scope: "everyone",
        blocking: input.blocking,
        status: "open",
        dueAt: input.dueAt,
        authoredScope: "group",
        groupId: input.groupId,
        editionId: input.editionId,
        audience: input.audience,
        // Snapshot the definition AS SENT so later edits to the live definition
        // never mutate what these respondents were shown.
        definition: input.definition,
        activatedByUserId: input.createdByUserId,
        openedAt: new Date(),
      })
      .returning({ id: schema.questionnaireActivations.id });
    const newActivationId = inserted[0]!.id;

    const rows = buildActivationRequiredActions(
      {
        id: newActivationId,
        title: input.title,
        blocking: input.blocking,
        dueAt: input.dueAt,
      },
      userIds,
    );
    if (rows.length > 0) {
      await tx
        .insert(schema.requiredActions)
        .values(
          rows.map((r) => ({
            userId: r.userId,
            // Per-edition (migration 0024): the uniqueness key is
            // (user, edition, action_key), so the same action key can be raised
            // again in a later burn instead of being permanently spent.
            editionId: input.editionId,
            type: r.type,
            actionKey: r.actionKey,
            activationId: r.activationId,
            title: r.title,
            blocking: r.blocking,
            status: r.status,
            dueAt: r.dueAt,
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.requiredActions.userId,
            schema.requiredActions.editionId,
            schema.requiredActions.actionKey,
          ],
        });
    }

    return newActivationId;
  });

  // Best-effort delivery, AFTER the rows are durably committed.
  const emailDelivered = await notifyTargets(userIds, {
    activationId,
    title: input.title,
    blocking: input.blocking,
    groupId: input.groupId,
  });

  return { activationId, sent: userIds.length, emailDelivered };
}

/**
 * Resolve a project audience to user ids using the pure core resolver. Only the
 * group's own memberships + custom-role assignments are loaded — a project
 * audience never reads org/registration/bio rows.
 */
async function resolveProjectTargets(
  groupId: string,
  editionId: string,
  audience: ProjectAudience,
): Promise<string[]> {
  const memberships = await db()
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.groupId, groupId));

  const roleAssignments = await db()
    .select({
      membershipId: schema.memberRoleAssignments.membershipId,
      projectRoleId: schema.memberRoleAssignments.projectRoleId,
      consent: schema.memberRoleAssignments.consentStatus,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .where(eq(schema.memberships.groupId, groupId));

  // Project_roles are needed for baseline derivation (the "everyone" role).
  const projectRoles = await db()
    .select({
      id: schema.projectRoles.id,
      groupId: schema.projectRoles.groupId,
      kind: schema.projectRoles.kind,
      officerKey: schema.projectRoles.officerKey,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId));

  const ctx: AudienceContext = {
    editionId,
    orgGroupId: "",
    memberships,
    groups: [],
    registrations: [],
    bios: [],
    roleAssignments,
    projectRoles: projectRoles.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      kind: r.kind,
      officerKey: (r.officerKey as OfficerKey | null) ?? null,
    })),
  };
  return resolveAudience(audience, ctx);
}

/** Email each targeted user their pending-questionnaire notice (console
 * fallback when Resend is unset). Returns whether delivery actually happened. */
async function notifyTargets(
  userIds: readonly string[],
  activation: {
    activationId: string;
    title: string;
    blocking: boolean;
    groupId: string;
  },
): Promise<boolean> {
  if (userIds.length === 0) return false;

  // THE IN-APP ROW FIRST, and independent of email. Activation used to write
  // `required_actions` plus an email and nothing else — so with no Resend key
  // (the current state: nobody has registered a domain yet) a targeted member
  // got no signal at all beyond a gate that silently appeared in front of them.
  // The inbox row is the delivery that always works.
  const [group] = await db()
    .select({ name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.id, activation.groupId))
    .limit(1);

  const payload = questionnaireReleasedNotification({
    title: activation.title,
    blocking: activation.blocking,
    activationId: activation.activationId,
    from: group?.name,
  });
  try {
    await insertNotifications(
      db(),
      // A CAMP sent this, not AfrikaBurn — that distinction is the whole
      // point of `origin`, and the title already names the camp.
      userIds.map((userId) => ({
        userId,
        ...payload,
        origin: "camp" as const,
        linkApp: "web" as const,
      })),
    );
  } catch (err) {
    // Never fail an activation that already committed over its inbox rows.
    console.error("[questionnaire] inbox notification write failed", err);
  }

  const users = await db()
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, [...userIds]));
  const emails = users
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));
  if (emails.length === 0) return false;

  const urgency = activation.blocking
    ? "It's required — it blocks the app until you complete it."
    : "It's optional, but the camp would appreciate your answer.";
  const result = await sendEmail({
    to: emails,
    subject: `Please complete: ${activation.title}`,
    text:
      `A camp questionnaire is waiting for you: "${activation.title}".\n\n` +
      `${urgency}\n\n` +
      `Open it here: /questionnaires/${activation.activationId}\n\n` +
      `Every question is one someone in the desert has to answer — thanks for taking the time.`,
  });
  return result.ok && result.delivered;
}

// --- Author-side: list + results (project dashboard) ---------------------

export interface ProjectQuestionnaireListItem {
  activationId: string;
  key: string;
  title: string;
  description: string | null;
  blocking: boolean;
  dueAt: Date | null;
  status: string;
  questionCount: number;
  createdAt: Date;
  sent: number;
  completed: number;
}

/** List a project's questionnaires (one row per activation) with completion. */
export async function listProjectQuestionnaires(
  groupId: string,
): Promise<ProjectQuestionnaireListItem[]> {
  const rows = await db()
    .select({
      activationId: schema.questionnaireActivations.id,
      key: schema.questionnaireActivations.questionnaireKey,
      title: schema.questionnaireActivations.title,
      description: schema.questionnaireActivations.description,
      blocking: schema.questionnaireActivations.blocking,
      dueAt: schema.questionnaireActivations.dueAt,
      status: schema.questionnaireActivations.status,
      createdAt: schema.questionnaireActivations.createdAt,
      snapshotDefinition: schema.questionnaireActivations.definition,
      liveDefinition: schema.questionnaireDefinitions.definition,
    })
    .from(schema.questionnaireActivations)
    .innerJoin(
      schema.questionnaireDefinitions,
      eq(
        schema.questionnaireDefinitions.key,
        schema.questionnaireActivations.questionnaireKey,
      ),
    )
    .where(
      and(
        eq(schema.questionnaireActivations.groupId, groupId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
      ),
    )
    .orderBy(desc(schema.questionnaireActivations.createdAt));

  const out: ProjectQuestionnaireListItem[] = [];
  for (const r of rows) {
    const actions = await db()
      .select({ status: schema.requiredActions.status })
      .from(schema.requiredActions)
      .where(eq(schema.requiredActions.activationId, r.activationId));
    const tally = tallyActivationCompletion(actions);
    // Count questions from the SNAPSHOT (what was sent); fall back to the live
    // definition only for pre-snapshot rows.
    const definition = resolveActivationDefinition(
      r.snapshotDefinition,
      r.liveDefinition,
    );
    out.push({
      activationId: r.activationId,
      key: r.key,
      title: r.title,
      description: r.description,
      blocking: r.blocking,
      dueAt: r.dueAt,
      status: r.status,
      questionCount: flattenQuestions(definition).length,
      createdAt: r.createdAt,
      sent: tally.sent,
      completed: tally.completed,
    });
  }
  return out;
}

/** A trimmed activation row for authz + rendering. */
export interface ActivationRow {
  id: string;
  questionnaireKey: string;
  title: string;
  description: string | null;
  blocking: boolean;
  dueAt: Date | null;
  status: string;
  authoredScope: "org" | "group";
  groupId: string | null;
  editionId: string | null;
  audience: AudienceSpec | null;
  definition: Questionnaire;
}

/** Load an activation and its definition, or null if unknown. */
export async function getActivation(
  activationId: string,
): Promise<ActivationRow | null> {
  const rows = await db()
    .select({
      id: schema.questionnaireActivations.id,
      questionnaireKey: schema.questionnaireActivations.questionnaireKey,
      title: schema.questionnaireActivations.title,
      description: schema.questionnaireActivations.description,
      blocking: schema.questionnaireActivations.blocking,
      dueAt: schema.questionnaireActivations.dueAt,
      status: schema.questionnaireActivations.status,
      authoredScope: schema.questionnaireActivations.authoredScope,
      groupId: schema.questionnaireActivations.groupId,
      editionId: schema.questionnaireActivations.editionId,
      audience: schema.questionnaireActivations.audience,
      snapshotDefinition: schema.questionnaireActivations.definition,
      liveDefinition: schema.questionnaireDefinitions.definition,
    })
    .from(schema.questionnaireActivations)
    .innerJoin(
      schema.questionnaireDefinitions,
      eq(
        schema.questionnaireDefinitions.key,
        schema.questionnaireActivations.questionnaireKey,
      ),
    )
    .where(eq(schema.questionnaireActivations.id, activationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { snapshotDefinition, liveDefinition, ...rest } = row;
  // Every fill / submit / results path resolves the activation through here, so
  // snapshotting the definition once here fixes them all: render/validate/
  // aggregate against what respondents were sent, live def only as the
  // pre-snapshot fallback.
  return {
    ...rest,
    definition: resolveActivationDefinition(snapshotDefinition, liveDefinition),
  };
}

export interface ActivationRespondent {
  userId: string;
  displayName: string;
  status: string;
  completedAt: Date | null;
  responses: QuestionnaireResponses | null;
}

export interface ActivationResults {
  activation: ActivationRow;
  respondents: ActivationRespondent[];
}

/**
 * The author-side results for an activation: every targeted user with their
 * completion status and (once submitted) their answers. Privacy boundary is
 * enforced by the CALLER via `canViewActivationResults`; this loader assumes it
 * has already passed.
 */
export async function getActivationResults(
  activationId: string,
  /** Kept for call-site symmetry with the org loader; respondent names are now
   * account-level (`users.username`), so nothing here is edition-scoped. */
  _editionId: string,
): Promise<ActivationResults | null> {
  const activation = await getActivation(activationId);
  if (!activation) return null;

  const actionRows = await db()
    .select({
      userId: schema.requiredActions.userId,
      status: schema.requiredActions.status,
      completedAt: schema.requiredActions.completedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.requiredActions)
    .innerJoin(schema.users, eq(schema.users.id, schema.requiredActions.userId))
    .where(eq(schema.requiredActions.activationId, activationId));

  const userIds = actionRows.map((r) => r.userId);
  const responseRows =
    userIds.length === 0
      ? []
      : await db()
          .select({
            userId: schema.questionnaireResponses.userId,
            responses: schema.questionnaireResponses.responses,
            activationId: schema.questionnaireResponses.activationId,
          })
          .from(schema.questionnaireResponses)
          .where(
            and(
              eq(
                schema.questionnaireResponses.definitionKey,
                activation.questionnaireKey,
              ),
              inArray(schema.questionnaireResponses.userId, userIds),
              // The ACTIVATION'S OWN edition, not the caller's active one —
              // otherwise viewing a past edition's activation from a page that
              // passes the current edition would blank every answer.
              ...(activation.editionId
                ? [
                    eq(
                      schema.questionnaireResponses.editionId,
                      activation.editionId,
                    ),
                  ]
                : []),
            ),
          );
  // NO activation-id filter. Within one edition a re-send is the same living
  // answer, and the row points at whichever send was answered LAST — so
  // filtering on it made the earlier send's results render blank the moment
  // anyone answered the later one. Answers belong to (person, questionnaire,
  // edition); the edition predicate above is what keeps years apart.
  const responseByUser = new Map<string, QuestionnaireResponses>();
  for (const r of responseRows) {
    responseByUser.set(r.userId, r.responses);
  }

  const respondents: ActivationRespondent[] = actionRows
    .map((r) => ({
      userId: r.userId,
      displayName: publicMemberName(r.username, {
        sanitizedAt: r.sanitizedAt,
      }),
      status: r.status,
      completedAt: r.completedAt,
      responses: responseByUser.get(r.userId) ?? null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { activation, respondents };
}

// --- Member-side: fill + pending list ------------------------------------

export interface FillView {
  activation: ActivationRow;
  /** The user's required-action status for this activation (null = not targeted). */
  actionStatus: "pending" | "completed" | "waived" | "expired" | null;
  initialResponses: QuestionnaireResponses;
}

/**
 * Load everything the fill page needs for a user, or null when the user was not
 * targeted (no `required_actions` row). Works identically for project- and
 * org-authored activations — the fill flow is scope-agnostic.
 */
export async function getFillView(
  activationId: string,
  userId: string,
): Promise<FillView | null> {
  const activation = await getActivation(activationId);
  if (!activation) return null;
  // Org-internal questionnaires gate the console only — never serve their fill
  // page in the participant app, even to an org member who is also a burner.
  if (!isParticipantFacingActivation(activation.audience)) return null;

  const actionRows = await db()
    .select({ status: schema.requiredActions.status })
    .from(schema.requiredActions)
    .where(
      and(
        eq(schema.requiredActions.userId, userId),
        eq(
          schema.requiredActions.actionKey,
          activationRequiredActionKey(activationId),
        ),
      ),
    )
    .limit(1);
  const actionStatus = actionRows[0]?.status ?? null;
  if (!actionStatus) return null;

  // PREFILL, scoped to the activation's edition.
  //
  // Deliberately NOT filtered by activation id: within one edition a re-send is
  // the same living answer, so the person sees what they said last time rather
  // than a blank form. Across editions the answer is a different row entirely,
  // which is what the edition filter enforces — without it, a 2028 send would
  // prefill with the 2027 answer.
  const prefillEditionId =
    activation.editionId ?? (await getActiveEdition())?.id ?? null;
  const responseRows = prefillEditionId
    ? await db()
        .select({ responses: schema.questionnaireResponses.responses })
        .from(schema.questionnaireResponses)
        .where(
          and(
            eq(schema.questionnaireResponses.userId, userId),
            eq(
              schema.questionnaireResponses.definitionKey,
              activation.questionnaireKey,
            ),
            eq(schema.questionnaireResponses.editionId, prefillEditionId),
          ),
        )
        .limit(1)
    : [];

  return {
    activation,
    actionStatus,
    initialResponses: responseRows[0]?.responses ?? {},
  };
}

export interface PendingQuestionnaire {
  activationId: string;
  title: string;
  blocking: boolean;
  dueAt: Date | null;
}

/**
 * A user's pending questionnaire activations (excludes the Burner Bio, which
 * has its own onboarding gate). Drives the "Pending questionnaires" card on the
 * dashboard + landing, and covers BOTH org-outbound and project sends.
 */
export async function listPendingQuestionnaires(
  userId: string,
): Promise<PendingQuestionnaire[]> {
  const rows = await db()
    .select({
      actionKey: schema.requiredActions.actionKey,
      title: schema.requiredActions.title,
      blocking: schema.requiredActions.blocking,
      dueAt: schema.requiredActions.dueAt,
      createdAt: schema.requiredActions.createdAt,
      audience: schema.questionnaireActivations.audience,
    })
    .from(schema.requiredActions)
    .leftJoin(
      schema.questionnaireActivations,
      eq(
        schema.questionnaireActivations.id,
        schema.requiredActions.activationId,
      ),
    )
    .where(
      and(
        eq(schema.requiredActions.userId, userId),
        eq(schema.requiredActions.type, "questionnaire"),
        eq(schema.requiredActions.status, "pending"),
      ),
    )
    .orderBy(desc(schema.requiredActions.createdAt));

  const out: PendingQuestionnaire[] = [];
  for (const r of rows) {
    // Org-internal sends never show in the participant's pending list.
    if (!isParticipantFacingActivation(r.audience)) continue;
    const activationId = parseActivationActionKey(r.actionKey);
    if (!activationId) continue; // skips the code-side Burner Bio action
    out.push({
      activationId,
      title: r.title,
      blocking: r.blocking,
      dueAt: r.dueAt,
    });
  }
  return out;
}

/**
 * Validate + persist a member's response, then flip the required action to
 * completed. Rejects a user who was never targeted. Idempotent on re-submit
 * (upsert on user × definition).
 */
export async function submitResponse(input: {
  userId: string;
  activationId: string;
  rawResponses: unknown;
}): Promise<SaveResult> {
  const activation = await getActivation(input.activationId);
  if (!activation) {
    return {
      ok: false,
      errors: { _form: "This questionnaire no longer exists." },
    };
  }
  // Org-internal questionnaires are submitted through the console gate, never
  // the participant flow — reject them here defensively (the fill page for them
  // is already withheld by getFillView).
  if (!isParticipantFacingActivation(activation.audience)) {
    return {
      ok: false,
      errors: { _form: "This questionnaire isn't available here." },
    };
  }

  const actionKey = activationRequiredActionKey(input.activationId);
  const actionRows = await db()
    .select({ id: schema.requiredActions.id })
    .from(schema.requiredActions)
    .where(
      and(
        eq(schema.requiredActions.userId, input.userId),
        eq(schema.requiredActions.actionKey, actionKey),
      ),
    )
    .limit(1);
  if (!actionRows[0]) {
    return {
      ok: false,
      errors: { _form: "This questionnaire wasn't sent to you." },
    };
  }

  // Branch-aware server-side validation (Runner v2): `validateSubmission`
  // re-derives the respondent's own path, so a required question inside a
  // section they branched PAST can neither block their submission nor have a
  // smuggled answer stored. Same `validateOne` rules per question as before.
  const validated = validateSubmission(
    activation.definition,
    input.rawResponses,
  );
  if (!validated.ok) return { ok: false, errors: validated.errors };

  // The answer belongs to the activation's EDITION. Re-sending inside one
  // edition keeps updating this row (the person is revising a living answer);
  // a new edition writes its own. Pre-feature activations have a null
  // edition_id, so fall back to the active edition rather than refusing.
  const editionId =
    activation.editionId ?? (await getActiveEdition())?.id ?? null;
  if (!editionId) {
    return {
      ok: false,
      errors: { _form: "No AfrikaBurn edition is set up yet." },
    };
  }

  const now = new Date();
  await db()
    .insert(schema.questionnaireResponses)
    .values({
      userId: input.userId,
      definitionKey: activation.questionnaireKey,
      editionId,
      definitionVersion: DEFINITION_VERSION,
      responses: validated.responses,
      activationId: input.activationId,
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
        activationId: input.activationId,
        completedAt: now,
        updatedAt: now,
      },
    });

  await completeRequiredAction(input.userId, editionId, actionKey);
  return { ok: true };
}

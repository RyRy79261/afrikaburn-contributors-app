import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  BURNER_BIO_ACTION_KEY,
  activationRequiredActionKey,
  resolveActivationDefinition,
  tallyActivationCompletion,
  type ActivationCompletion,
  type AudienceContext,
} from "@quagga/core";
import {
  ORG_OUTBOUND_SELECTOR_LABELS,
  OFFICER_AUDIENCE_LABELS,
  flattenQuestions,
  type AudienceSpec,
  type OfficerKey,
  type Questionnaire,
  type QuestionnaireResponses,
} from "@quagga/types";

import { getDb, schema } from "@/lib/db";

// Read models for the console's questionnaire surfaces. Every function is
// read-only and assumes the caller cleared the console gate (resolveOrgSession);
// none re-checks auth. Results-visibility scoping (org vs project) is enforced
// by only ever querying `authored_scope = 'org'` activations here, backed by the
// core `canViewActivationResults` predicate in the pages/actions.

/** True for a definition the org console owns: an `org-` prefixed key (all
 * console-created keys carry it) or one with any org-scoped activation. */
function isOrgDefinitionKey(key: string): boolean {
  return key.startsWith("org-");
}

export interface ActivationSummary {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  blocking: boolean;
  dueAt: Date | null;
  audienceLabel: string;
  audienceKind: AudienceSpec["kind"] | null;
  completion: ActivationCompletion;
  openedAt: Date | null;
  createdAt: Date;
}

export interface OrgQuestionnaireSummary {
  key: string;
  title: string;
  status: "draft" | "published" | "unpublished";
  version: string | null;
  fieldCount: number;
  updatedAt: Date;
  activations: ActivationSummary[];
}

/** Human label for an audience spec (list + results copy). */
export function audienceLabel(spec: AudienceSpec | null): string {
  if (!spec) return "No audience";
  switch (spec.kind) {
    case "org_internal":
      return "Org members (internal)";
    case "org_outbound":
      return spec.selectors
        .map((s) => ORG_OUTBOUND_SELECTOR_LABELS[s] ?? s)
        .join(", ");
    case "org_officer":
      return spec.officerKeys
        .map((k) => OFFICER_AUDIENCE_LABELS[k] ?? k)
        .join(", ");
    case "project":
      return "Project members";
  }
}

/** Count ANSWERABLE questions across a stored definition's pages — Builder v2
 * info/image blocks live in the same list but take no answer, so they must not
 * inflate the "12 questions" count an author sees. */
function countFields(definition: Questionnaire): number {
  return flattenQuestions(definition).length;
}

/**
 * All org-owned questionnaire definitions with their org-scoped activations and
 * per-activation completion tallies. Excludes the Burner Bio code questionnaire
 * and any project-authored definitions.
 */
export async function listOrgQuestionnaires(): Promise<
  OrgQuestionnaireSummary[]
> {
  const db = getDb();

  const definitions = await db
    .select()
    .from(schema.questionnaireDefinitions)
    .orderBy(desc(schema.questionnaireDefinitions.updatedAt));

  const activations = await db
    .select()
    .from(schema.questionnaireActivations)
    .where(eq(schema.questionnaireActivations.authoredScope, "org"))
    .orderBy(desc(schema.questionnaireActivations.createdAt));

  const orgActivationKeys = new Set(activations.map((a) => a.questionnaireKey));

  const included = definitions.filter(
    (d) =>
      d.key !== BURNER_BIO_ACTION_KEY &&
      (isOrgDefinitionKey(d.key) || orgActivationKeys.has(d.key)),
  );

  // Completion tallies for every org activation in one query.
  const completions = await tallyActivations(activations.map((a) => a.id));

  const byKey = new Map<string, ActivationSummary[]>();
  for (const a of activations) {
    const spec = (a.audience ?? null) as AudienceSpec | null;
    const summary: ActivationSummary = {
      id: a.id,
      title: a.title,
      description: a.description,
      status: a.status,
      blocking: a.blocking,
      dueAt: a.dueAt,
      audienceLabel: audienceLabel(spec),
      audienceKind: spec?.kind ?? null,
      completion: completions.get(a.id) ?? { sent: 0, completed: 0, pending: 0 },
      openedAt: a.openedAt,
      createdAt: a.createdAt,
    };
    const list = byKey.get(a.questionnaireKey) ?? [];
    list.push(summary);
    byKey.set(a.questionnaireKey, list);
  }

  return included.map((d) => ({
    key: d.key,
    title: d.title,
    status: d.status,
    version: d.version,
    fieldCount: countFields(d.definition),
    updatedAt: d.updatedAt,
    activations: byKey.get(d.key) ?? [],
  }));
}

/** Tally sent/completed/pending for each activation id from required_actions. */
async function tallyActivations(
  activationIds: string[],
): Promise<Map<string, ActivationCompletion>> {
  const out = new Map<string, ActivationCompletion>();
  if (activationIds.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select({
      activationId: schema.requiredActions.activationId,
      status: schema.requiredActions.status,
    })
    .from(schema.requiredActions)
    .where(inArray(schema.requiredActions.activationId, activationIds));

  const grouped = new Map<string, { status: string }[]>();
  for (const r of rows) {
    if (!r.activationId) continue;
    const list = grouped.get(r.activationId) ?? [];
    list.push({ status: r.status });
    grouped.set(r.activationId, list);
  }
  for (const id of activationIds) {
    out.set(id, tallyActivationCompletion(grouped.get(id) ?? []));
  }
  return out;
}

export interface OrgDefinition {
  key: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "unpublished";
  version: string | null;
  definition: Questionnaire;
  updatedAt: Date;
}

/** One org-owned definition by key, or null if missing / not org-owned. */
export async function getOrgDefinition(
  key: string,
): Promise<OrgDefinition | null> {
  if (key === BURNER_BIO_ACTION_KEY) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.questionnaireDefinitions)
    .where(eq(schema.questionnaireDefinitions.key, key))
    .limit(1);
  if (!row) return null;

  // Guard scope: a project-authored definition (non org- key with only group
  // activations) is not visible in the console.
  if (!isOrgDefinitionKey(row.key)) {
    const [orgAct] = await db
      .select({ id: schema.questionnaireActivations.id })
      .from(schema.questionnaireActivations)
      .where(
        and(
          eq(schema.questionnaireActivations.questionnaireKey, key),
          eq(schema.questionnaireActivations.authoredScope, "org"),
        ),
      )
      .limit(1);
    if (!orgAct) return null;
  }

  // Description is stored as the first questions-page subtitle.
  const firstQuestions = row.definition.pages.find(
    (p): p is Extract<Questionnaire["pages"][number], { kind: "questions" }> =>
      p.kind === "questions",
  );

  return {
    key: row.key,
    title: row.title,
    description: firstQuestions?.subtitle ?? null,
    status: row.status,
    version: row.version,
    definition: row.definition,
    updatedAt: row.updatedAt,
  };
}

export interface ActivationDetail {
  id: string;
  questionnaireKey: string;
  title: string;
  description: string | null;
  version: string;
  status: "draft" | "open" | "closed";
  blocking: boolean;
  dueAt: Date | null;
  authoredScope: "org" | "group";
  groupId: string | null;
  audience: AudienceSpec | null;
  audienceLabel: string;
  definition: Questionnaire;
  createdAt: Date;
}

/** Full read model for one org-scoped activation, or null if missing/off-scope. */
export async function getOrgActivation(
  activationId: string,
): Promise<ActivationDetail | null> {
  const db = getDb();
  const [a] = await db
    .select()
    .from(schema.questionnaireActivations)
    .where(eq(schema.questionnaireActivations.id, activationId))
    .limit(1);
  if (!a || a.authoredScope !== "org") return null;

  const [def] = await db
    .select()
    .from(schema.questionnaireDefinitions)
    .where(eq(schema.questionnaireDefinitions.key, a.questionnaireKey))
    .limit(1);
  if (!def) return null;

  const spec = (a.audience ?? null) as AudienceSpec | null;
  return {
    id: a.id,
    questionnaireKey: a.questionnaireKey,
    title: a.title,
    description: a.description,
    version: a.version,
    status: a.status,
    blocking: a.blocking,
    dueAt: a.dueAt,
    authoredScope: a.authoredScope,
    groupId: a.groupId,
    audience: spec,
    audienceLabel: audienceLabel(spec),
    // Results/rendering aggregate against the SNAPSHOT (what respondents were
    // sent); fall back to the live definition only for pre-snapshot rows.
    definition: resolveActivationDefinition(a.definition, def.definition),
    createdAt: a.createdAt,
  };
}

export interface ResultRow {
  userId: string;
  email: string | null;
  status: "pending" | "completed" | "waived" | "expired";
  completedAt: Date | null;
  responses: QuestionnaireResponses | null;
}

/**
 * Per-user completion table for one activation: every targeted user (a
 * required_action row) with their status and — for completed ones — the response
 * map. Scope is already enforced by the caller (org activation only).
 */
export async function getActivationResults(
  activationId: string,
  definitionKey: string,
): Promise<ResultRow[]> {
  const db = getDb();
  const actionKey = activationRequiredActionKey(activationId);

  const actions = await db
    .select({
      userId: schema.requiredActions.userId,
      email: schema.users.email,
      status: schema.requiredActions.status,
      completedAt: schema.requiredActions.completedAt,
    })
    .from(schema.requiredActions)
    .leftJoin(schema.users, eq(schema.users.id, schema.requiredActions.userId))
    .where(eq(schema.requiredActions.actionKey, actionKey))
    .orderBy(asc(schema.users.email));

  const userIds = actions.map((a) => a.userId);
  const responsesByUser = new Map<string, QuestionnaireResponses>();
  if (userIds.length > 0) {
    const responses = await db
      .select({
        userId: schema.questionnaireResponses.userId,
        responses: schema.questionnaireResponses.responses,
        activationId: schema.questionnaireResponses.activationId,
      })
      .from(schema.questionnaireResponses)
      .where(
        and(
          eq(schema.questionnaireResponses.definitionKey, definitionKey),
          inArray(schema.questionnaireResponses.userId, userIds),
        ),
      );
    for (const r of responses) {
      // Only surface the response tied to THIS activation (privacy: never bleed
      // another activation's answers into these results).
      if (r.activationId === activationId) {
        responsesByUser.set(r.userId, r.responses);
      }
    }
  }

  return actions.map((a) => ({
    userId: a.userId,
    email: a.email,
    status: a.status,
    completedAt: a.completedAt,
    responses: responsesByUser.get(a.userId) ?? null,
  }));
}

/**
 * Load every row set `resolveAudience` reads, scoped to an edition. The
 * resolution itself is the pure core function; this is the I/O boundary.
 */
export async function buildAudienceContext(
  editionId: string,
  orgGroupId: string,
): Promise<AudienceContext> {
  const db = getDb();

  const [memberships, groups, registrations, bios, roleAssignments, projectRoles] =
    await Promise.all([
      db
        .select({
          membershipId: schema.memberships.id,
          userId: schema.memberships.userId,
          groupId: schema.memberships.groupId,
          role: schema.memberships.role,
        })
        .from(schema.memberships),
      db
        .select({ id: schema.groups.id, kind: schema.groups.kind })
        .from(schema.groups),
      db
        .select({
          groupId: schema.registrations.groupId,
          editionId: schema.registrations.editionId,
          status: schema.registrations.status,
          grantsInterest: schema.registrations.grantsInterest,
        })
        .from(schema.registrations)
        .where(eq(schema.registrations.editionId, editionId)),
      db
        .select({
          userId: schema.burnerBios.userId,
          editionId: schema.burnerBios.editionId,
        })
        .from(schema.burnerBios)
        .where(eq(schema.burnerBios.editionId, editionId)),
      db
        .select({
          membershipId: schema.memberRoleAssignments.membershipId,
          projectRoleId: schema.memberRoleAssignments.projectRoleId,
          consent: schema.memberRoleAssignments.consentStatus,
        })
        .from(schema.memberRoleAssignments),
      db
        .select({
          id: schema.projectRoles.id,
          groupId: schema.projectRoles.groupId,
          kind: schema.projectRoles.kind,
          officerKey: schema.projectRoles.officerKey,
        })
        .from(schema.projectRoles),
    ]);

  return {
    editionId,
    orgGroupId,
    memberships,
    groups,
    registrations,
    bios,
    roleAssignments,
    projectRoles: projectRoles.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      kind: r.kind,
      officerKey: (r.officerKey as OfficerKey | null) ?? null,
    })),
  };
}

export interface ConsoleGateQuestionnaire {
  activationId: string;
  definitionKey: string;
  definitionVersion: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  questionnaire: Questionnaire;
  existingResponses: QuestionnaireResponses;
}

/**
 * The first pending BLOCKING org-internal questionnaire gating this console user,
 * or null. Org-internal activations (audience.kind = org_internal) gate the
 * console the way blocking questionnaires gate the participant app. Outbound and
 * Burner-Bio actions never gate the console.
 */
export async function getConsoleBlockingQuestionnaire(
  dbUserId: string,
): Promise<ConsoleGateQuestionnaire | null> {
  const db = getDb();

  const rows = await db
    .select({
      activationId: schema.requiredActions.activationId,
      title: schema.requiredActions.title,
      dueAt: schema.requiredActions.dueAt,
      createdAt: schema.requiredActions.createdAt,
      questionnaireKey: schema.questionnaireActivations.questionnaireKey,
      version: schema.questionnaireActivations.version,
      description: schema.questionnaireActivations.description,
      authoredScope: schema.questionnaireActivations.authoredScope,
      audience: schema.questionnaireActivations.audience,
      snapshotDefinition: schema.questionnaireActivations.definition,
    })
    .from(schema.requiredActions)
    .innerJoin(
      schema.questionnaireActivations,
      eq(
        schema.questionnaireActivations.id,
        schema.requiredActions.activationId,
      ),
    )
    .where(
      and(
        eq(schema.requiredActions.userId, dbUserId),
        eq(schema.requiredActions.type, "questionnaire"),
        eq(schema.requiredActions.blocking, true),
        eq(schema.requiredActions.status, "pending"),
        eq(schema.questionnaireActivations.authoredScope, "org"),
      ),
    )
    .orderBy(asc(schema.requiredActions.createdAt));

  const gate = rows.find((r) => {
    const spec = (r.audience ?? null) as AudienceSpec | null;
    return spec?.kind === "org_internal" && r.activationId != null;
  });
  if (!gate || !gate.activationId) return null;

  const [def] = await db
    .select({
      definition: schema.questionnaireDefinitions.definition,
    })
    .from(schema.questionnaireDefinitions)
    .where(eq(schema.questionnaireDefinitions.key, gate.questionnaireKey))
    .limit(1);
  if (!def) return null;

  const [existing] = await db
    .select({ responses: schema.questionnaireResponses.responses })
    .from(schema.questionnaireResponses)
    .where(
      and(
        eq(schema.questionnaireResponses.userId, dbUserId),
        eq(
          schema.questionnaireResponses.definitionKey,
          gate.questionnaireKey,
        ),
      ),
    )
    .limit(1);

  return {
    activationId: gate.activationId,
    definitionKey: gate.questionnaireKey,
    definitionVersion: gate.version,
    title: gate.title,
    description: gate.description,
    dueAt: gate.dueAt,
    // Gate the console against the SNAPSHOT; live def is the pre-snapshot fallback.
    questionnaire: resolveActivationDefinition(
      gate.snapshotDefinition,
      def.definition,
    ),
    existingResponses: existing?.responses ?? {},
  };
}

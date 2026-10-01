import "server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  carryForwardOnboarding,
  clampOnboardingProgress,
  defaultOnboardingAudience,
  isOnboardingDefinition,
  onboardingTitleFor,
  publicMemberName,
  resolveActivationDefinition,
  summarizeOnboarding,
  tallyActivationCompletion,
  tallyOnboardingCompletion,
  validateOnboardingDefinition,
  buildOnboardingPreset,
  type OnboardingCompletion,
  type OnboardingProgressReport,
  type OnboardingNamesFilter,
} from "@quagga/core";
import type { CampTenure, ProjectAudience, Questionnaire } from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction } from "./db";
import { loadCampTenure } from "./camp-tenure";
import {
  getActivation,
  insertActivationActions,
  notifyQuestionnaireTargets,
  resolveProjectTargets,
  type ActivationRow,
} from "./questionnaire-store";

// Camp onboarding persistence (epic #54). An onboarding is a camp
// questionnaire built from the onboarding preset (`definition.preset`), so it
// lives in the same three tables as every other one:
//
//   questionnaire_definitions   the definition (status `draft` → `published`)
//   questionnaire_activations   status `draft` → `open` (→ `closed` on recall)
//   required_actions            one per targeted member, written at SEND
//
// What is new is the DRAFT: the preset, the builder's autosave and the
// carried-forward copy all write an activation in status `draft`, which has
// no required_actions and so reaches nobody — the fill page and the submit
// action both refuse a person with no action row. Sending is a compare-and-set
// from `draft` to `open` in the same transaction that writes the actions, so a
// double-click or a second tab sends once.
//
// AUTHZ IS THE CALLER'S. Every function here trusts that the server action in
// front of it ran the @quagga/core predicate for the actor; what this layer
// guarantees is that it only ever touches rows of the group it was given.

const DEFINITION_VERSION = "1";

/** SQL: this activation's snapshot is an onboarding. */
const isOnboardingRow = sql`${schema.questionnaireActivations.definition} ->> 'preset' = 'onboarding'`;

function newDefinitionKey(groupId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `proj:${groupId}:${rand}`;
}

// --- Drafts ---------------------------------------------------------------

export interface OnboardingDraftInput {
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

/** Write a new draft (definition + activation, one transaction). Reaches
 * nobody: a draft has no required_actions. */
async function insertDraft(input: OnboardingDraftInput): Promise<string> {
  const key = newDefinitionKey(input.groupId);
  return withTransaction(async (tx) => {
    await tx.insert(schema.questionnaireDefinitions).values({
      key,
      title: input.title,
      definition: input.definition,
      status: "draft",
      version: DEFINITION_VERSION,
      createdByUserId: input.createdByUserId,
    });
    const [row] = await tx
      .insert(schema.questionnaireActivations)
      .values({
        questionnaireKey: key,
        version: DEFINITION_VERSION,
        title: input.title,
        description: input.description,
        scope: "everyone",
        blocking: input.blocking,
        status: "draft",
        dueAt: input.dueAt,
        authoredScope: "group",
        groupId: input.groupId,
        editionId: input.editionId,
        audience: input.audience,
        definition: input.definition,
        activatedByUserId: input.createdByUserId,
      })
      .returning({ id: schema.questionnaireActivations.id });
    return row!.id;
  });
}

/** Start an onboarding from the preset (A1 → A2). NOT blocking by default
 * (Ryan, 27 Sep 2026); leads and co-leads off the audience by default. */
export async function createOnboardingDraft(input: {
  groupId: string;
  editionId: string;
  createdByUserId: string;
  campName: string;
}): Promise<string> {
  return insertDraft({
    groupId: input.groupId,
    editionId: input.editionId,
    createdByUserId: input.createdByUserId,
    title: onboardingTitleFor(input.campName),
    description: null,
    definition: buildOnboardingPreset(),
    audience: defaultOnboardingAudience(input.groupId),
    blocking: false,
    dueAt: null,
  });
}

/** A draft onboarding of THIS group, or null (not found, not this camp's, not
 * an onboarding, or no longer a draft). */
export interface OnboardingDraftRow extends ActivationRow {
  audience: ProjectAudience;
  /** The draft's version stamp — Send claims the draft only if it is still
   * exactly the row that was authorised (see sendOnboardingDraft). */
  updatedAt: Date;
}

export async function getOnboardingDraft(
  activationId: string,
  groupId: string,
): Promise<OnboardingDraftRow | null> {
  const activation = await getActivation(activationId);
  if (
    !activation ||
    activation.groupId !== groupId ||
    activation.authoredScope !== "group" ||
    activation.status !== "draft" ||
    activation.audience?.kind !== "project" ||
    !isOnboardingDefinition(activation.definition)
  ) {
    return null;
  }
  const [stamp] = await db()
    .select({ updatedAt: schema.questionnaireActivations.updatedAt })
    .from(schema.questionnaireActivations)
    .where(eq(schema.questionnaireActivations.id, activationId))
    .limit(1);
  if (!stamp) return null;
  return {
    ...activation,
    audience: activation.audience,
    updatedAt: stamp.updatedAt,
  };
}

export type SaveDraftResult =
  { ok: true } | { ok: false; reason: "not_draft" | "invalid"; error: string };

/**
 * Autosave. A compare-and-set on `status = 'draft'` AND this group: once sent,
 * a draft is immutable here (a sent onboarding's text is what its members
 * were shown — the activation snapshot must never drift under them).
 */
export async function saveOnboardingDraft(input: {
  activationId: string;
  groupId: string;
  title: string;
  description: string | null;
  definition: Questionnaire;
  audience: ProjectAudience;
  blocking: boolean;
  dueAt: Date | null;
}): Promise<SaveDraftResult> {
  const valid = validateOnboardingDefinition(input.definition);
  if (!valid.ok) return { ok: false, reason: "invalid", error: valid.error };
  const now = new Date();
  return withTransaction(async (tx) => {
    const [row] = await tx
      .update(schema.questionnaireActivations)
      .set({
        title: input.title,
        description: input.description,
        definition: valid.definition,
        audience: input.audience,
        blocking: input.blocking,
        dueAt: input.dueAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.questionnaireActivations.id, input.activationId),
          eq(schema.questionnaireActivations.groupId, input.groupId),
          eq(schema.questionnaireActivations.status, "draft"),
          isOnboardingRow,
        ),
      )
      .returning({ key: schema.questionnaireActivations.questionnaireKey });
    if (!row) {
      return {
        ok: false as const,
        reason: "not_draft" as const,
        error: "This onboarding has already been sent — it can't be edited.",
      };
    }
    await tx
      .update(schema.questionnaireDefinitions)
      .set({ title: input.title, definition: valid.definition, updatedAt: now })
      .where(eq(schema.questionnaireDefinitions.key, row.key));
    return { ok: true as const };
  });
}

/** Delete a draft that was never sent (definition + activation). A sent one is
 * never deleted — it is recalled with Close, which keeps the answers. */
export async function discardOnboardingDraft(
  activationId: string,
  groupId: string,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [row] = await tx
      .delete(schema.questionnaireActivations)
      .where(
        and(
          eq(schema.questionnaireActivations.id, activationId),
          eq(schema.questionnaireActivations.groupId, groupId),
          eq(schema.questionnaireActivations.status, "draft"),
          isOnboardingRow,
        ),
      )
      .returning({ key: schema.questionnaireActivations.questionnaireKey });
    if (!row) return false;
    await tx
      .delete(schema.questionnaireDefinitions)
      .where(
        and(
          eq(schema.questionnaireDefinitions.key, row.key),
          eq(schema.questionnaireDefinitions.status, "draft"),
        ),
      );
    return true;
  });
}

export type SendDraftResult =
  | { ok: true; sent: number; emailDelivered: boolean }
  | { ok: false; error: string };

/**
 * SEND a draft: `draft` → `open`, one required_action per targeted member, in
 * one transaction; notification + email after it commits.
 *
 * The draft is re-read and re-validated here rather than trusted from the
 * client: what is sent is exactly what is stored. A draft written for an
 * earlier edition is refused — carrying forward is how last year's reaches
 * this year, and it makes a new draft.
 */
export async function sendOnboardingDraft(input: {
  /** The draft row the CALLER authorised — sent as-is, never re-read, and
   * claimed only if it is still that exact version (`updatedAt`). A save that
   * lands in between (say, switching blocking on) makes the claim miss rather
   * than sending something nobody authorised. */
  draft: OnboardingDraftRow;
  groupId: string;
  activeEditionId: string;
  senderUserId: string;
}): Promise<SendDraftResult> {
  const { draft } = input;
  const activationId = draft.id;
  if (draft.groupId !== input.groupId || draft.status !== "draft") {
    return { ok: false, error: "This onboarding has already been sent." };
  }
  if (draft.editionId !== input.activeEditionId) {
    return {
      ok: false,
      error:
        "This draft was written for an earlier edition and can't be sent this year — discard it and start again.",
    };
  }
  const valid = validateOnboardingDefinition(draft.definition);
  if (!valid.ok) return { ok: false, error: valid.error };
  const audience = draft.audience;

  const userIds = await resolveProjectTargets(
    input.groupId,
    input.activeEditionId,
    audience,
  );

  const now = new Date();
  const claimed = await withTransaction(async (tx) => {
    const [row] = await tx
      .update(schema.questionnaireActivations)
      .set({
        status: "open",
        openedAt: now,
        activatedByUserId: input.senderUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.questionnaireActivations.id, activationId),
          eq(schema.questionnaireActivations.groupId, input.groupId),
          eq(schema.questionnaireActivations.status, "draft"),
          eq(schema.questionnaireActivations.updatedAt, draft.updatedAt),
        ),
      )
      .returning({ key: schema.questionnaireActivations.questionnaireKey });
    if (!row) return false;
    await tx
      .update(schema.questionnaireDefinitions)
      .set({ status: "published", updatedAt: now })
      .where(eq(schema.questionnaireDefinitions.key, row.key));
    await insertActivationActions(
      tx,
      {
        id: activationId,
        title: draft.title,
        blocking: draft.blocking,
        dueAt: draft.dueAt,
        editionId: input.activeEditionId,
      },
      userIds,
    );
    return true;
  });
  if (!claimed) {
    return {
      ok: false,
      error:
        "This onboarding changed or was already sent while you were sending it — reload and try again.",
    };
  }

  const emailDelivered = await notifyQuestionnaireTargets(userIds, {
    activationId,
    title: draft.title,
    blocking: draft.blocking,
    groupId: input.groupId,
    onboarding: true,
  });
  return { ok: true, sent: userIds.length, emailDelivered };
}

// --- The camp's onboardings, by edition -----------------------------------

export interface OnboardingSummaryRow {
  activationId: string;
  title: string;
  status: string;
  editionId: string | null;
}

/** This group's onboardings for one edition (drafts included), newest first. */
export async function listOnboardingsForEdition(
  groupId: string,
  editionId: string,
): Promise<OnboardingSummaryRow[]> {
  return db()
    .select({
      activationId: schema.questionnaireActivations.id,
      title: schema.questionnaireActivations.title,
      status: schema.questionnaireActivations.status,
      editionId: schema.questionnaireActivations.editionId,
    })
    .from(schema.questionnaireActivations)
    .where(
      and(
        eq(schema.questionnaireActivations.groupId, groupId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        eq(schema.questionnaireActivations.editionId, editionId),
        isOnboardingRow,
      ),
    )
    .orderBy(desc(schema.questionnaireActivations.createdAt));
}

// --- Carry forward (ONBOARD-022) ------------------------------------------

export interface OnboardingCarryOffer {
  activationId: string;
  title: string;
  editionName: string;
  complete: number;
  sent: number;
}

/**
 * The onboarding this camp SENT for the most recent earlier edition — what the
 * list offers to carry forward (A5). Drafts never qualify: an unsent draft
 * from last year is not "last year's onboarding".
 */
export async function findOnboardingCarrySource(
  groupId: string,
  activeEditionYear: number,
): Promise<OnboardingCarryOffer | null> {
  const [row] = await db()
    .select({
      activationId: schema.questionnaireActivations.id,
      title: schema.questionnaireActivations.title,
      editionName: schema.editions.name,
    })
    .from(schema.questionnaireActivations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.questionnaireActivations.editionId),
    )
    .where(
      and(
        eq(schema.questionnaireActivations.groupId, groupId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        inArray(schema.questionnaireActivations.status, ["open", "closed"]),
        lt(schema.editions.year, activeEditionYear),
        isOnboardingRow,
      ),
    )
    .orderBy(
      desc(schema.editions.year),
      desc(schema.questionnaireActivations.createdAt),
    )
    .limit(1);
  if (!row) return null;
  const actions = await db()
    .select({ status: schema.requiredActions.status })
    .from(schema.requiredActions)
    .where(eq(schema.requiredActions.activationId, row.activationId));
  const tally = tallyActivationCompletion(
    actions.filter((a) => a.status !== "waived"),
  );
  return { ...row, complete: tally.completed, sent: tally.sent };
}

/**
 * PREPARE carrying an earlier edition's onboarding into THIS edition as a new
 * DRAFT (written by `insertOnboardingDraft` after the caller authorises the
 * carried audience — a scoped author may not create a draft they could not
 * then edit or send). Only
 * the source this camp actually sent for an earlier edition may be carried
 * (re-checked here, not trusted from the client). Custom roles the camp has
 * since deleted drop out of the audience rather than dangling.
 */
export async function prepareOnboardingCarry(input: {
  sourceActivationId: string;
  groupId: string;
  activeEditionId: string;
  activeEditionYear: number;
  userId: string;
}): Promise<
  { ok: true; draft: OnboardingDraftInput } | { ok: false; error: string }
> {
  const [row] = await db()
    .select({
      title: schema.questionnaireActivations.title,
      description: schema.questionnaireActivations.description,
      blocking: schema.questionnaireActivations.blocking,
      audience: schema.questionnaireActivations.audience,
      snapshot: schema.questionnaireActivations.definition,
      live: schema.questionnaireDefinitions.definition,
      year: schema.editions.year,
      status: schema.questionnaireActivations.status,
    })
    .from(schema.questionnaireActivations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.questionnaireActivations.editionId),
    )
    .innerJoin(
      schema.questionnaireDefinitions,
      eq(
        schema.questionnaireDefinitions.key,
        schema.questionnaireActivations.questionnaireKey,
      ),
    )
    .where(
      and(
        eq(schema.questionnaireActivations.id, input.sourceActivationId),
        eq(schema.questionnaireActivations.groupId, input.groupId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        isOnboardingRow,
      ),
    )
    .limit(1);
  if (
    !row ||
    row.year >= input.activeEditionYear ||
    row.status === "draft" ||
    row.audience?.kind !== "project"
  ) {
    return { ok: false, error: "There's no earlier onboarding to carry over." };
  }
  const definition = resolveActivationDefinition(row.snapshot, row.live);

  const liveRoles = await db()
    .select({ id: schema.projectRoles.id })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, input.groupId));
  const liveRoleIds = new Set(liveRoles.map((r) => r.id));

  const carried = carryForwardOnboarding(
    {
      title: row.title,
      description: row.description,
      definition,
      audience: row.audience,
      blocking: row.blocking,
    },
    input.groupId,
  );
  // Deleted roles drop out — and if that empties a role narrowing, it stays a
  // role narrowing (reaching nobody, which Send refuses) rather than silently
  // widening to the whole camp. The builder says so and asks for a choice.
  const roleIds = carried.audience.roleIds.filter((id) => liveRoleIds.has(id));
  const audience: ProjectAudience = { ...carried.audience, roleIds };

  return {
    ok: true,
    draft: {
      groupId: input.groupId,
      editionId: input.activeEditionId,
      createdByUserId: input.userId,
      title: carried.title,
      description: carried.description,
      definition: carried.definition,
      audience,
      blocking: carried.blocking,
      dueAt: null,
    },
  };
}

/** Write a carried-forward draft once the caller has authorised ITS audience
 * and blocking choice (see prepareOnboardingCarry). */
export async function insertOnboardingDraft(
  draft: OnboardingDraftInput,
): Promise<string> {
  return insertDraft(draft);
}

// --- The lead's completion view (ONBOARD-020) -----------------------------

export interface OnboardingNameRow {
  userId: string;
  displayName: string;
  tenure: CampTenure;
  status: string;
  completedAt: Date | null;
  /** Furthest step reached, or null when their runner never reported. */
  furthestStep: number | null;
}

export interface OnboardingCompletionView {
  activation: ActivationRow;
  totals: OnboardingCompletion;
  /** Current members of the camp (leads included) — the "of 18". */
  memberCount: number;
  /** Null unless names were asked for. */
  names: OnboardingNameRow[] | null;
  summary: ReturnType<typeof summarizeOnboarding>;
}

/**
 * Totals first; names ONLY when `names` is given (ONBOARD-020). The names query
 * is not merely hidden when not asked for — it is not run, so a page that
 * shows totals has never loaded anybody's name.
 *
 * Counts CURRENT members only: the required_actions are joined to this camp's
 * active memberships, so a former member's row (kept as history) is never in
 * a total or a list.
 */
export async function getOnboardingCompletion(input: {
  activationId: string;
  groupId: string;
  names: OnboardingNamesFilter | null;
}): Promise<OnboardingCompletionView | null> {
  const activation = await getActivation(input.activationId);
  if (
    !activation ||
    activation.groupId !== input.groupId ||
    activation.authoredScope !== "group" ||
    activation.status === "draft" ||
    !isOnboardingDefinition(activation.definition) ||
    !activation.editionId
  ) {
    return null;
  }

  const rows = await db()
    .select({
      userId: schema.requiredActions.userId,
      status: schema.requiredActions.status,
      completedAt: schema.requiredActions.completedAt,
      membershipId: schema.memberships.id,
      furthestStep: schema.onboardingProgress.furthestStep,
    })
    .from(schema.requiredActions)
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.requiredActions.userId),
        eq(schema.memberships.groupId, input.groupId),
        activeMembership(),
      ),
    )
    .leftJoin(
      schema.onboardingProgress,
      and(
        eq(
          schema.onboardingProgress.activationId,
          schema.requiredActions.activationId,
        ),
        eq(schema.onboardingProgress.userId, schema.requiredActions.userId),
      ),
    )
    .where(eq(schema.requiredActions.activationId, input.activationId));

  const tenure = await loadCampTenure(input.groupId, activation.editionId);
  const tagged = rows.map((r) => ({
    ...r,
    tenure: tenure.get(r.membershipId) ?? ("new" as CampTenure),
    started: typeof r.furthestStep === "number",
  }));
  const totals = tallyOnboardingCompletion(tagged);

  const [count] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.groupId, input.groupId), activeMembership()),
    );

  let names: OnboardingNameRow[] | null = null;
  if (input.names) {
    const wanted = tagged.filter((r) => {
      if (r.status === "waived") return false;
      if (input.names === "complete") return r.status === "completed";
      if (input.names === "incomplete") return r.status !== "completed";
      return true;
    });
    const users =
      wanted.length === 0
        ? []
        : await db()
            .select({
              id: schema.users.id,
              username: schema.users.username,
              sanitizedAt: schema.users.sanitizedAt,
            })
            .from(schema.users)
            .where(
              inArray(
                schema.users.id,
                wanted.map((r) => r.userId),
              ),
            );
    const byId = new Map(users.map((u) => [u.id, u]));
    names = wanted
      .map((r) => {
        const u = byId.get(r.userId);
        return {
          userId: r.userId,
          displayName: publicMemberName(u?.username ?? null, {
            sanitizedAt: u?.sanitizedAt ?? null,
          }),
          tenure: r.tenure,
          status: r.status,
          completedAt: r.completedAt,
          furthestStep: r.furthestStep,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  return {
    activation,
    totals,
    memberCount: count?.n ?? 0,
    names,
    summary: summarizeOnboarding(activation.definition),
  };
}

// --- Late joiners ("people who join later get it too") --------------------

/**
 * Deliver this camp's OPEN onboardings (active edition) to someone who just
 * joined, when its audience reaches them. The audience is resolved exactly as
 * at send time — same resolver, same filters — so joining never reaches
 * anyone the lead did not target (a new co-lead is still skipped when leads
 * are off). Idempotent: an existing action row is left alone, and only a NEW
 * row gets a notification.
 *
 * Best-effort by design: the caller has already committed the join, and a
 * failure here must never undo or fail it.
 */
export async function deliverOpenOnboardingsToNewMember(input: {
  groupId: string;
  userId: string;
  editionId: string;
}): Promise<number> {
  const open = await db()
    .select({ id: schema.questionnaireActivations.id })
    .from(schema.questionnaireActivations)
    .where(
      and(
        eq(schema.questionnaireActivations.groupId, input.groupId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        eq(schema.questionnaireActivations.editionId, input.editionId),
        eq(schema.questionnaireActivations.status, "open"),
        isOnboardingRow,
      ),
    );
  let delivered = 0;
  for (const { id } of open) {
    const activation = await getActivation(id);
    if (!activation || activation.audience?.kind !== "project") continue;
    if (activation.audience.groupId !== input.groupId) continue;
    const targets = await resolveProjectTargets(
      input.groupId,
      input.editionId,
      activation.audience,
    );
    if (!targets.includes(input.userId)) continue;
    const added = await withTransaction(async (tx) => {
      // Hold the activation row so a concurrent Close (which updates it) can't
      // slip between this check and the insert: a closed onboarding is never
      // delivered.
      const [live] = await tx
        .select({ status: schema.questionnaireActivations.status })
        .from(schema.questionnaireActivations)
        .where(eq(schema.questionnaireActivations.id, id))
        .for("update");
      if (live?.status !== "open") return [];
      const fresh = await insertActivationActions(
        tx,
        {
          id,
          title: activation.title,
          blocking: activation.blocking,
          dueAt: activation.dueAt,
          editionId: input.editionId,
        },
        [input.userId],
      );
      if (fresh.length > 0) return fresh;
      // A former member let back in: archiving WAIVED their row, and the
      // insert above is a no-op against it. They are a member again and the
      // audience reaches them, so the withdrawal is undone.
      const revived = await tx
        .update(schema.requiredActions)
        .set({ status: "pending", completedAt: null })
        .where(
          and(
            eq(schema.requiredActions.activationId, id),
            eq(schema.requiredActions.userId, input.userId),
            eq(schema.requiredActions.editionId, input.editionId),
            eq(schema.requiredActions.status, "waived"),
          ),
        )
        .returning({ userId: schema.requiredActions.userId });
      return revived.map((r) => r.userId);
    });
    if (added.length === 0) continue;
    delivered += 1;
    await notifyQuestionnaireTargets(added, {
      activationId: id,
      title: activation.title,
      blocking: activation.blocking,
      groupId: input.groupId,
      onboarding: true,
    });
  }
  return delivered;
}

// --- Partial progress (Ryan, 1 Oct 2026) -----------------------------------

/**
 * Record how far a member has got through an onboarding they were SENT. Only
 * moves forward (`greatest`), so a stale tab reporting an earlier step never
 * winds anyone back; the ticks are the latest report, since unticking a box
 * is a real change of mind.
 *
 * Refuses (returns false, writes nothing) unless the activation is an OPEN
 * onboarding and this person holds a PENDING action for it — the same
 * "were you sent this, and is it still live" test the submit action applies.
 * The report is clamped to the onboarding's own sections and boxes first.
 */
export async function saveOnboardingProgress(input: {
  activationId: string;
  userId: string;
  report: OnboardingProgressReport;
}): Promise<boolean> {
  const activation = await getActivation(input.activationId);
  if (
    !activation ||
    activation.status !== "open" ||
    !isOnboardingDefinition(activation.definition)
  ) {
    return false;
  }
  const [action] = await db()
    .select({ status: schema.requiredActions.status })
    .from(schema.requiredActions)
    .where(
      and(
        eq(schema.requiredActions.activationId, input.activationId),
        eq(schema.requiredActions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!action || action.status !== "pending") return false;

  const clamped = clampOnboardingProgress(activation.definition, input.report);
  const now = new Date();
  await db()
    .insert(schema.onboardingProgress)
    .values({
      activationId: input.activationId,
      userId: input.userId,
      furthestStep: clamped.step,
      acknowledged: clamped.acknowledged,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.onboardingProgress.activationId,
        schema.onboardingProgress.userId,
      ],
      set: {
        furthestStep: sql`greatest(${schema.onboardingProgress.furthestStep}, excluded.furthest_step)`,
        acknowledged: clamped.acknowledged,
        updatedAt: now,
      },
    });
  return true;
}

/** The ticks this person has already reported for an onboarding — so the
 * boxes they ticked on one device are ticked on the next. Empty when none. */
export async function getOwnOnboardingTicks(
  activationId: string,
  userId: string,
): Promise<string[]> {
  const [row] = await db()
    .select({ acknowledged: schema.onboardingProgress.acknowledged })
    .from(schema.onboardingProgress)
    .where(
      and(
        eq(schema.onboardingProgress.activationId, activationId),
        eq(schema.onboardingProgress.userId, userId),
      ),
    )
    .limit(1);
  return row?.acknowledged ?? [];
}

import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  buildProjectCarryForwardAnswers,
  canManageProjectSafetyDocuments,
  carriedSafetyDocuments,
  mergeCarriedSafetyDocuments,
  mergeProjectCarryForward,
  projectCarriedColumns,
  resolveCampAction,
  type SafetyDocumentInput,
} from "@quagga/core";
import type {
  MembershipRole,
  QuestionnaireResponses,
  RegistrationStatus,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";
import { prepareCampCreate, createCampWrites } from "./groups-store";
import {
  EDITABLE_STATUSES,
  findCarryForwardSource,
  type CarryForwardSource,
} from "./registration-store";

// Mutant-vehicle + art-project registration persistence (build-spec §"Status
// board KPI row": MUTANT VEHICLES / ARTWORKS are counted from `groups.kind` ×
// `registrations`). Server-only; the pages own the Zod boundary and the
// submit-gate, this layer only writes.
//
// WHY THIS SHAPE (no migrations were permitted, and none are needed):
//
//   1. The GROUP is the project. `groups.kind` already carries `mutant_vehicle`
//      and `artwork`, and creation follows the exact `/camps/new` path
//      (`createCamp`) so name dedupe, slugging, and the creator-becomes-lead
//      rule are shared rather than re-implemented.
//   2. The REGISTRATION ROW is the status carrier. `org-stats` and the audience
//      resolver (`mv_grant_requesters` / `art_grant_requesters`) already read
//      `registrations` joined to non-camp group kinds, and `grants_interest`
//      exists on that table *specifically* for the MV/art grant flag. Only the
//      columns whose meaning stays TRUE for a vehicle/artwork are written —
//      contact email, uploads, area dimensions, sound level, placement, LNT
//      plan, grants interest — so the org console's camp-labelled read view
//      never shows a mislabelled answer.
//   3. The KIND-SPECIFIC ANSWERS (base vehicle, flame effects, night driving,
//      DMV acknowledgements, artist, burn intent, power, build/strike plans)
//      have no honest camp column, so they live in the questionnaire spine's
//      free-form `questionnaire_responses.responses` jsonb under a
//      project-namespaced key (`proj:<groupId>:…`, the same convention
//      `questionnaire-store` uses). No activation and no `required_actions` row
//      is created — nobody is being *asked* anything, the registrant is
//      authoring — so this never appears in anyone's pending list, never
//      blocks, and never collides with an activation's results (those are
//      filtered by activation id). Namespacing by group id also means one
//      burner can register many vehicles without tripping the
//      unique(user, definition_key) index.
//
// The mirrored columns are also kept in the answer payload, so the payload is a
// complete, self-describing record of what was submitted.

/** The two project kinds this flow registers. */
export type ProjectRegistrationKind = "mutant_vehicle" | "artwork";

/** Payload schema version stored on the response row. */
export const PROJECT_REGISTRATION_VERSION = "1";

const KIND_SLUG: Record<ProjectRegistrationKind, string> = {
  mutant_vehicle: "mv-registration",
  artwork: "art-registration",
};

/**
 * The `questionnaire_responses.definition_key` holding a project's own
 * registration answers. Uses the existing `proj:<groupId>:` namespace so the
 * key is unambiguously project-scoped (and unique per project).
 */
export function projectRegistrationAnswerKey(
  groupId: string,
  kind: ProjectRegistrationKind,
): string {
  return `proj:${groupId}:${KIND_SLUG[kind]}`;
}

/** The `registrations` columns whose camp-side meaning survives unchanged for a
 * mutant vehicle or an artwork. Anything else belongs in `answers`. */
export interface ProjectRegistrationColumns {
  /** Photos / concept images (max 4 — `MAX_LAYOUT_UPLOADS`). */
  imageUrls: string[];
  /** A `SOUND_SCALE` value — drives `soundLevelFromValue` + officer triggers. */
  soundLevel?: string | null;
  /** Free-text footprint, e.g. "4 m W × 4 m D × 12 m H". */
  areaDimensions?: string | null;
  /** Placement preference / notes. */
  placementNotes?: string | null;
  /** Leave No Trace / strike plan. */
  lntPlan?: string | null;
  /** Grant interest — the `art_grant_requesters` / `mv_grant_requesters` flag. */
  grantsInterest?: boolean | null;
  /** Work Access Passes requested (CREATIVE-014) — the same
   * `s4_work_access_passes` column a camp's Form 2 writes, so WAP allocation
   * reads one column whatever kind of group asked. */
  workAccessPasses?: number | null;
}

export interface ProjectRegistrationInput {
  creatorId: string;
  /** The account email; used for `s1_contact_email` (derive over ask). */
  creatorEmail: string | null;
  editionId: string;
  kind: ProjectRegistrationKind;
  name: string;
  description: string | null;
  /** true → `submitted`; false → saved as a `draft`. */
  submit: boolean;
  columns: ProjectRegistrationColumns;
  answers: QuestionnaireResponses;
  /** Safety documents (CREATIVE-017). Private to leads/admins + org staff. */
  safetyDocuments?: readonly SafetyDocumentInput[];
}

export type ProjectRegistrationResult =
  { ok: true; slug: string } | { ok: false; error: string };

/**
 * Create the project group, its edition registration row, and its answer
 * payload — all in ONE transaction. Returns the new group's slug on success.
 *
 * Atomicity matters here: a mutant vehicle / artwork "is" its group + its
 * registration row + its namespaced answer payload. A partial write (a group
 * with no registration, or a registration with no answers) would surface as a
 * broken, half-registered project on the org status board. The camp name/slug is
 * validated BEFORE the transaction opens (read-only), then group, membership,
 * registration and answers commit together — or not at all.
 */
export async function createProjectRegistration(
  input: ProjectRegistrationInput,
): Promise<ProjectRegistrationResult> {
  const prep = await prepareCampCreate({
    creatorId: input.creatorId,
    name: input.name,
    kind: input.kind,
    description: input.description,
    // Projects start invite-only: a build crew is assembled, not walked into.
    joinability: "invite_only",
  });
  if (!prep.ok) return { ok: false, error: prep.error };

  const now = new Date();
  try {
    const slug = await withTransaction(async (tx) => {
      const { groupId, slug } = await createCampWrites(tx, prep.prepared);

      const [registration] = await tx
        .insert(schema.registrations)
        .values({
          groupId,
          editionId: input.editionId,
          status: input.submit ? "submitted" : "draft",
          s1ContactEmail: input.creatorEmail,
          s2LntPlan: input.columns.lntPlan ?? null,
          s4WorkAccessPasses: input.columns.workAccessPasses ?? null,
          s4AreaDimensions: input.columns.areaDimensions ?? null,
          s4LayoutUploadUrls: input.columns.imageUrls,
          s5AmplifiedMusic: input.columns.soundLevel ?? null,
          s5PlacementFirstChoice: input.columns.placementNotes ?? null,
          grantsInterest: input.columns.grantsInterest ?? null,
          // `completed_sections` is the six-section CAMP wizard's progress
          // marker — it has no meaning here, so it stays empty rather than lying.
          completedSections: [],
          submittedAt: input.submit ? now : null,
        })
        .onConflictDoNothing({
          target: [
            schema.registrations.groupId,
            schema.registrations.editionId,
          ],
        })
        .returning({ id: schema.registrations.id });

      // The group was created in this same transaction, so the registration
      // row cannot already exist — but a missing id must never silently drop
      // the documents the registrant attached.
      const documents = input.safetyDocuments ?? [];
      if (registration) {
        await syncSafetyDocuments(
          tx,
          registration.id,
          documents,
          input.creatorId,
        );
      } else if (documents.length > 0) {
        throw new Error("registration row missing for safety documents");
      }

      await tx
        .insert(schema.questionnaireResponses)
        .values({
          userId: input.creatorId,
          definitionKey: projectRegistrationAnswerKey(groupId, input.kind),
          editionId: input.editionId,
          definitionVersion: PROJECT_REGISTRATION_VERSION,
          responses: input.answers,
          completedAt: input.submit ? now : null,
        })
        .onConflictDoUpdate({
          target: [
            schema.questionnaireResponses.userId,
            schema.questionnaireResponses.definitionKey,
            schema.questionnaireResponses.editionId,
          ],
          // MANDATORY, and its absence is a runtime error rather than a subtle one.
          // Migration 0028 split the uniqueness rule in two: person-scoped answers
          // are unique per (user, definition, edition) WHERE group_id IS NULL, and
          // camp-scoped ones include the camp. Postgres will not use a PARTIAL index
          // to resolve ON CONFLICT unless the statement repeats its predicate, so
          // without this the insert fails outright with "there is no unique or
          // exclusion constraint matching the ON CONFLICT specification" — which is
          // what happened to every questionnaire write, the Burner Bio included,
          // until an e2e run caught it.
          targetWhere: isNull(schema.questionnaireResponses.groupId),
          set: {
            responses: input.answers,
            completedAt: input.submit ? now : null,
            updatedAt: now,
          },
        });

      return slug;
    });
    return { ok: true, slug };
  } catch (err) {
    // A concurrent same-name create loses the unique-index race — surface the
    // same graceful message createCamp uses rather than a 500.
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        error: "A project of this kind already uses that name. Pick another.",
      };
    }
    throw err;
  }
}

/** Postgres unique-violation SQLSTATE, surfaced by the Neon driver as `.code`. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/** Everything the MV/art EDIT page needs: the project, the viewer's role, the
 * registration status + whether it is still editable, and the prior answers to
 * prefill the form. Null when the slug isn't a project of `kind`. */
export interface ProjectRegistrationEditContext {
  group: { id: string; name: string; slug: string; description: string | null };
  role: MembershipRole | null;
  /** The current registration status (`draft` when no row exists yet). */
  status: RegistrationStatus;
  /** True while the form may be edited + resubmitted (draft / changes_requested). */
  editable: boolean;
  /** The prior answer payload (the self-describing record) to prefill the form. */
  answers: QuestionnaireResponses | null;
  /** Work Access Passes requested for this edition (null = not asked). */
  workAccessPasses: number | null;
  /** This edition's safety documents — ONLY loaded for the project's
   * structural lead/admin (`canManageProjectSafetyDocuments`); an empty list
   * for anyone else, so no caller can render them to the wrong person. */
  safetyDocuments: StoredSafetyDocument[];
  /** True once this edition's draft has been seeded from a prior year. */
  carriedForward: boolean;
}

/** A persisted safety document, as the edit form and review views read it. */
export interface StoredSafetyDocument {
  id: string;
  title: string;
  url: string;
  expiresOn: string;
}

/**
 * Load the edit context for a mutant-vehicle / artwork registration. Verifies the
 * slug resolves to a group of the expected `kind`; resolves the viewer's role;
 * reads the registration status (defaulting to `draft` when unstarted) and the
 * prior answers. Authz decisions are the caller's — this only reads.
 */
export async function getProjectRegistrationForEdit(
  slug: string,
  kind: ProjectRegistrationKind,
  viewerId: string,
  editionId: string,
): Promise<ProjectRegistrationEditContext | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      description: schema.groups.description,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind !== kind) return null;

  const [membership] = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, viewerId),
        eq(schema.memberships.groupId, group.id),
      ),
    )
    .limit(1);

  const [registration] = await db()
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      workAccessPasses: schema.registrations.s4WorkAccessPasses,
      carriedForwardAt: schema.registrations.carriedForwardAt,
    })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, group.id),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  const status: RegistrationStatus = registration?.status ?? "draft";

  const answers = await getProjectRegistrationAnswers(
    group.id,
    kind,
    editionId,
  );

  // Safety documents are private to the structural lead/admin. The decision is
  // taken HERE, before the read, so a stranger's context never holds them.
  const safetyDocuments =
    registration && canManageProjectSafetyDocuments(membership?.role)
      ? await listSafetyDocuments(registration.id)
      : [];

  return {
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
    },
    role: membership?.role ?? null,
    status,
    editable: EDITABLE_STATUSES.includes(status),
    answers,
    workAccessPasses: registration?.workAccessPasses ?? null,
    safetyDocuments,
    carriedForward: Boolean(registration?.carriedForwardAt),
  };
}

export interface ProjectRegistrationUpdateInput {
  groupId: string;
  editionId: string;
  kind: ProjectRegistrationKind;
  /** The editor's user id — used only when NO answer row exists yet (fallback
   * insert); an existing row is updated in place regardless of who authored it. */
  editorUserId: string;
  /** The editor's account email — the contact email when this edition's row is
   * created here (a returning project's first save of a new year). */
  editorEmail: string | null;
  description: string | null;
  submit: boolean;
  columns: ProjectRegistrationColumns;
  answers: QuestionnaireResponses;
  safetyDocuments?: readonly SafetyDocumentInput[];
}

/**
 * Update an existing MV/art registration and (optionally) resubmit it. Respects
 * the state machine: only `draft` / `changes_requested` are editable; a submit
 * runs the same `resolveCampAction` transition the camp wizard uses (draft →
 * submitted, changes_requested → resubmitted), throwing on any illegal move.
 *
 * The answer payload is updated on the EXISTING project-scoped row (found by its
 * project-namespaced key), never keyed to the editor — so a co-lead editing a
 * lead's registration updates the one record instead of forking a second.
 * Group, registration and answers commit in one transaction.
 */
export async function updateProjectRegistration(
  input: ProjectRegistrationUpdateInput,
): Promise<ProjectRegistrationResult> {
  const now = new Date();
  const [current] = await db()
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      slug: schema.groups.slug,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(
      and(
        eq(schema.registrations.groupId, input.groupId),
        eq(schema.registrations.editionId, input.editionId),
      ),
    )
    .limit(1);
  if (!current) {
    // A RETURNING PROJECT IN A NEW EDITION. The create path writes the first
    // edition's row together with the group, so an absent row used to mean
    // "something is wrong" and this refused. It also means "a vehicle that
    // registered for 2027 opening its 2028 registration" — and refusing that
    // left every project unable to register a second year at all (the edit
    // page opened, and every save said it hadn't been started). The caller has
    // already resolved the group, its kind and the editor's lead/admin role.
    return startProjectRegistrationEdition(input, now);
  }
  if (!EDITABLE_STATUSES.includes(current.status)) {
    return {
      ok: false,
      error:
        "This registration is locked — it can't be edited in its current state.",
    };
  }

  // Resolve the next status through the shared state machine (throws if illegal).
  let nextStatus: RegistrationStatus = current.status;
  if (input.submit) {
    const action =
      current.status === "changes_requested" ? "resubmit" : "submit";
    nextStatus = resolveCampAction(current.status, action);
  }

  const answerKey = projectRegistrationAnswerKey(input.groupId, input.kind);

  await withTransaction(async (tx) => {
    await tx
      .update(schema.groups)
      .set({ description: input.description, updatedAt: now })
      .where(eq(schema.groups.id, input.groupId));

    await tx
      .update(schema.registrations)
      .set({
        status: nextStatus,
        s2LntPlan: input.columns.lntPlan ?? null,
        s4WorkAccessPasses: input.columns.workAccessPasses ?? null,
        s4AreaDimensions: input.columns.areaDimensions ?? null,
        s4LayoutUploadUrls: input.columns.imageUrls,
        s5AmplifiedMusic: input.columns.soundLevel ?? null,
        s5PlacementFirstChoice: input.columns.placementNotes ?? null,
        grantsInterest: input.columns.grantsInterest ?? null,
        ...(input.submit ? { submittedAt: now } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.registrations.groupId, input.groupId),
          eq(schema.registrations.editionId, input.editionId),
        ),
      );

    // Scoped to the EDITION being edited. The probe used to match on
    // `definition_key` alone — and a project's answer key is deterministic
    // (`proj:<groupId>:mv-registration`), so once the same vehicle registers for
    // a second year this would have found and overwritten the PREVIOUS year's
    // answers. Ordered so the row picked is deterministic rather than whatever
    // the planner returned first.
    const [existingAnswers] = await tx
      .select({ id: schema.questionnaireResponses.id })
      .from(schema.questionnaireResponses)
      .where(
        and(
          eq(schema.questionnaireResponses.definitionKey, answerKey),
          eq(schema.questionnaireResponses.editionId, input.editionId),
        ),
      )
      .orderBy(asc(schema.questionnaireResponses.id))
      .limit(1);
    if (existingAnswers) {
      await tx
        .update(schema.questionnaireResponses)
        .set({
          responses: input.answers,
          completedAt: input.submit ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.questionnaireResponses.id, existingAnswers.id));
    } else {
      await tx.insert(schema.questionnaireResponses).values({
        userId: input.editorUserId,
        definitionKey: answerKey,
        editionId: input.editionId,
        definitionVersion: PROJECT_REGISTRATION_VERSION,
        responses: input.answers,
        completedAt: input.submit ? now : null,
      });
    }

    await syncSafetyDocuments(
      tx,
      current.id,
      input.safetyDocuments ?? [],
      input.editorUserId,
    );
  });

  return { ok: true, slug: current.slug };
}

/**
 * Open a returning project's registration for a new edition: this edition's
 * `registrations` row, its answer payload and its safety documents, in one
 * transaction. The status still comes from the shared state machine — a first
 * save that is also a submit goes `draft → submitted` via `resolveCampAction`,
 * never written as submitted by a local string.
 */
async function startProjectRegistrationEdition(
  input: ProjectRegistrationUpdateInput,
  now: Date,
): Promise<ProjectRegistrationResult> {
  const status: RegistrationStatus = input.submit
    ? resolveCampAction("draft", "submit")
    : "draft";

  return withTransaction(async (tx): Promise<ProjectRegistrationResult> => {
    const [group] = await tx
      .select({ slug: schema.groups.slug })
      .from(schema.groups)
      .where(eq(schema.groups.id, input.groupId))
      .limit(1);
    if (!group) return { ok: false, error: "This project no longer exists." };

    await tx
      .update(schema.groups)
      .set({ description: input.description, updatedAt: now })
      .where(eq(schema.groups.id, input.groupId));

    const [registration] = await tx
      .insert(schema.registrations)
      .values({
        groupId: input.groupId,
        editionId: input.editionId,
        status,
        s1ContactEmail: input.editorEmail,
        s2LntPlan: input.columns.lntPlan ?? null,
        s4WorkAccessPasses: input.columns.workAccessPasses ?? null,
        s4AreaDimensions: input.columns.areaDimensions ?? null,
        s4LayoutUploadUrls: input.columns.imageUrls,
        s5AmplifiedMusic: input.columns.soundLevel ?? null,
        s5PlacementFirstChoice: input.columns.placementNotes ?? null,
        grantsInterest: input.columns.grantsInterest ?? null,
        completedSections: [],
        submittedAt: input.submit ? now : null,
      })
      // Two co-leads opening the new year at once: the second loses the
      // unique-index race and is told to reload, rather than overwriting.
      .onConflictDoNothing({
        target: [schema.registrations.groupId, schema.registrations.editionId],
      })
      .returning({ id: schema.registrations.id });
    if (!registration) {
      return {
        ok: false,
        error:
          "This registration changed while you were editing — reload and try again.",
      };
    }

    await tx.insert(schema.questionnaireResponses).values({
      userId: input.editorUserId,
      definitionKey: projectRegistrationAnswerKey(input.groupId, input.kind),
      editionId: input.editionId,
      definitionVersion: PROJECT_REGISTRATION_VERSION,
      responses: input.answers,
      completedAt: input.submit ? now : null,
    });

    await syncSafetyDocuments(
      tx,
      registration.id,
      input.safetyDocuments ?? [],
      input.editorUserId,
    );

    return { ok: true, slug: group.slug };
  });
}

// --- Safety documents (CREATIVE-017) -------------------------------------
// Private evidence attached to one registration. Reads here are UNGATED — the
// callers (`getProjectRegistrationForEdit`, the actions) decide who may see
// them through `canManageProjectSafetyDocuments` before calling.

/** This registration's safety documents, oldest first. */
export async function listSafetyDocuments(
  registrationId: string,
): Promise<StoredSafetyDocument[]> {
  return db()
    .select({
      id: schema.registrationSafetyDocuments.id,
      title: schema.registrationSafetyDocuments.title,
      url: schema.registrationSafetyDocuments.url,
      expiresOn: schema.registrationSafetyDocuments.expiresOn,
    })
    .from(schema.registrationSafetyDocuments)
    .where(
      eq(schema.registrationSafetyDocuments.registrationId, registrationId),
    )
    .orderBy(
      asc(schema.registrationSafetyDocuments.createdAt),
      asc(schema.registrationSafetyDocuments.id),
    );
}

/** Identity of a document for diffing: the same file, title and expiry. */
function documentIdentity(d: {
  title: string;
  url: string;
  expiresOn: string;
}): string {
  return JSON.stringify([d.title.trim(), d.url.trim(), d.expiresOn]);
}

/**
 * Make this registration's documents exactly `next`, inside the caller's
 * transaction. The form sends the whole list, so this is a replace — but an
 * UNCHANGED document keeps its row (and so its original uploader and upload
 * time) instead of being deleted and re-inserted under whoever saved last.
 */
export async function syncSafetyDocuments(
  tx: Tx,
  registrationId: string,
  next: readonly SafetyDocumentInput[],
  editorUserId: string,
): Promise<void> {
  const existing = await tx
    .select({
      id: schema.registrationSafetyDocuments.id,
      title: schema.registrationSafetyDocuments.title,
      url: schema.registrationSafetyDocuments.url,
      expiresOn: schema.registrationSafetyDocuments.expiresOn,
    })
    .from(schema.registrationSafetyDocuments)
    .where(
      eq(schema.registrationSafetyDocuments.registrationId, registrationId),
    );

  const unmatched = new Map<string, string[]>();
  for (const row of existing) {
    const key = documentIdentity(row);
    unmatched.set(key, [...(unmatched.get(key) ?? []), row.id]);
  }

  const toInsert: SafetyDocumentInput[] = [];
  for (const doc of next) {
    const ids = unmatched.get(documentIdentity(doc));
    if (ids && ids.length > 0) ids.shift();
    else toInsert.push(doc);
  }
  const toDelete = [...unmatched.values()].flat();

  if (toDelete.length > 0) {
    await tx
      .delete(schema.registrationSafetyDocuments)
      .where(
        and(
          eq(schema.registrationSafetyDocuments.registrationId, registrationId),
          inArray(schema.registrationSafetyDocuments.id, toDelete),
        ),
      );
  }
  if (toInsert.length > 0) {
    await tx.insert(schema.registrationSafetyDocuments).values(
      toInsert.map((d) => ({
        registrationId,
        title: d.title.trim(),
        url: d.url.trim(),
        expiresOn: d.expiresOn,
        uploadedByUserId: editorUserId,
      })),
    );
  }
}

// --- Previous-year duplication (CREATIVE-019) -----------------------------
// The camp feature (registration-store `carryForwardRegistration`), for a
// project. POLICY is @quagga/core `project-registration`: an allow-list of
// answers that carry, everything new-every-year starting empty, intents and
// consents never copied, and safety documents copied only while still valid
// through the new edition's end. This layer finds the prior year and applies it.

export type ProjectCarryForwardResult =
  | {
      ok: true;
      filled: number;
      documents: number;
      /** Carried documents NOT added: the draft already held that file, or
       * was full (MAX_SAFETY_DOCUMENTS). */
      documentsSkipped: number;
      source: CarryForwardSource;
    }
  | { ok: false; error: string };

/**
 * Seed this edition's draft from the project's most recent prior registration.
 *
 * NEVER A SUBMISSION. The row it creates (or finds) stays a draft, the answer
 * payload's `completedAt` is written null, and the kind's submit gate still
 * needs answers that deliberately never carry — so a returning project cannot
 * carry forward and submit in one breath. Only EMPTY answers are filled, so a
 * lead's typing this year survives.
 *
 * CONCURRENCY. The merge replaces the WHOLE answer payload, so the rows it
 * reads are taken `FOR UPDATE` — the registration first (the same order a save
 * writes them, so the two cannot deadlock), then the answer row. A co-lead's
 * save that commits first is therefore what the merge reads; one that arrives
 * later waits for this transaction and then writes its own full form. The
 * compare-and-set on the registration is kept for the insert-race path, where
 * there is no row to lock yet.
 *
 * Documents are ADDED to what the draft already holds, de-duplicated by file
 * and capped at MAX_SAFETY_DOCUMENTS (`mergeCarriedSafetyDocuments`), so a
 * carry can never leave a list the form would refuse to save.
 */
export async function carryForwardProjectRegistration(input: {
  groupId: string;
  kind: ProjectRegistrationKind;
  editionId: string;
  editionYear: number;
  editionEndDate: string;
  editorUserId: string;
  editorEmail: string | null;
}): Promise<ProjectCarryForwardResult> {
  const source = await findCarryForwardSource(input.groupId, input.editionYear);
  if (!source) {
    return {
      ok: false,
      error: "We can't find an earlier registration for this project.",
    };
  }

  const priorAnswers = await getProjectRegistrationAnswers(
    input.groupId,
    input.kind,
    source.editionId,
  );
  const priorDocuments = await db()
    .select({
      title: schema.registrationSafetyDocuments.title,
      url: schema.registrationSafetyDocuments.url,
      expiresOn: schema.registrationSafetyDocuments.expiresOn,
      uploadedByUserId: schema.registrationSafetyDocuments.uploadedByUserId,
    })
    .from(schema.registrationSafetyDocuments)
    .where(
      eq(
        schema.registrationSafetyDocuments.registrationId,
        source.registrationId,
      ),
    )
    .orderBy(asc(schema.registrationSafetyDocuments.createdAt));

  const patch = buildProjectCarryForwardAnswers(input.kind, priorAnswers);
  const carriedDocuments = carriedSafetyDocuments(priorDocuments, {
    endDate: input.editionEndDate,
  });
  const answerKey = projectRegistrationAnswerKey(input.groupId, input.kind);

  return withTransaction(async (tx): Promise<ProjectCarryForwardResult> => {
    const [existing] = await tx
      .select({
        id: schema.registrations.id,
        status: schema.registrations.status,
        carriedForwardAt: schema.registrations.carriedForwardAt,
      })
      .from(schema.registrations)
      .where(
        and(
          eq(schema.registrations.groupId, input.groupId),
          eq(schema.registrations.editionId, input.editionId),
        ),
      )
      .limit(1)
      .for("update");

    if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
      return {
        ok: false,
        error: "This registration is locked while AfrikaBurn reviews it.",
      };
    }
    if (existing?.carriedForwardAt) {
      return {
        ok: false,
        error: "Last year's answers have already been brought across.",
      };
    }

    const [currentAnswers] = await tx
      .select({
        id: schema.questionnaireResponses.id,
        responses: schema.questionnaireResponses.responses,
      })
      .from(schema.questionnaireResponses)
      .where(
        and(
          eq(schema.questionnaireResponses.definitionKey, answerKey),
          eq(schema.questionnaireResponses.editionId, input.editionId),
        ),
      )
      .orderBy(asc(schema.questionnaireResponses.id))
      .limit(1)
      .for("update");

    // Read under the registration lock, so a concurrent save's document sync
    // has either committed (and is counted) or has not started.
    const heldDocuments = existing
      ? await tx
          .select({ url: schema.registrationSafetyDocuments.url })
          .from(schema.registrationSafetyDocuments)
          .where(
            eq(schema.registrationSafetyDocuments.registrationId, existing.id),
          )
      : [];

    const { answers, filled } = mergeProjectCarryForward(
      currentAnswers?.responses ?? null,
      patch,
    );
    const documents = mergeCarriedSafetyDocuments(
      heldDocuments,
      carriedDocuments,
    );
    if (filled.length === 0 && documents.add.length === 0) {
      return {
        ok: false,
        error:
          "There's nothing to bring across — everything last year's registration could fill is already answered.",
      };
    }

    const now = new Date();
    const columns = {
      ...projectCarriedColumns(input.kind, answers),
      carriedForwardFromId: source.registrationId,
      carriedForwardAt: now,
      updatedAt: now,
    };
    const conflict = {
      ok: false,
      error:
        "This registration changed while you were reading it — reload and try again.",
    } as const;

    let registrationId: string;
    if (existing) {
      const updated = await tx
        .update(schema.registrations)
        .set(columns)
        .where(
          and(
            eq(schema.registrations.id, existing.id),
            eq(schema.registrations.status, existing.status),
            isNull(schema.registrations.carriedForwardAt),
          ),
        )
        .returning({ id: schema.registrations.id });
      if (updated.length === 0) return conflict;
      registrationId = existing.id;
    } else {
      const [inserted] = await tx
        .insert(schema.registrations)
        .values({
          groupId: input.groupId,
          editionId: input.editionId,
          status: "draft",
          s1ContactEmail: input.editorEmail,
          completedSections: [],
          ...columns,
        })
        .onConflictDoNothing({
          target: [
            schema.registrations.groupId,
            schema.registrations.editionId,
          ],
        })
        .returning({ id: schema.registrations.id });
      if (!inserted) return conflict;
      registrationId = inserted.id;
    }

    // PRE-FILLED IS NOT COMPLETE: `completedAt` is written null on both paths.
    if (currentAnswers) {
      await tx
        .update(schema.questionnaireResponses)
        .set({ responses: answers, completedAt: null, updatedAt: now })
        .where(eq(schema.questionnaireResponses.id, currentAnswers.id));
    } else {
      await tx.insert(schema.questionnaireResponses).values({
        userId: input.editorUserId,
        definitionKey: answerKey,
        editionId: input.editionId,
        definitionVersion: PROJECT_REGISTRATION_VERSION,
        responses: answers,
        completedAt: null,
      });
    }

    // New rows, so this year's list can change without touching last year's
    // evidence. The original uploader is kept — they supplied it.
    if (documents.add.length > 0) {
      await tx.insert(schema.registrationSafetyDocuments).values(
        documents.add.map((d) => ({
          registrationId,
          title: d.title,
          url: d.url,
          expiresOn: d.expiresOn,
          uploadedByUserId: d.uploadedByUserId,
        })),
      );
    }

    return {
      ok: true,
      filled: filled.length,
      documents: documents.add.length,
      documentsSkipped: documents.skippedDuplicate + documents.skippedFull,
      source,
    };
  });
}

/**
 * Read back a project's registration answers (the free-form half). Returns null
 * when the project never submitted this form.
 */
export async function getProjectRegistrationAnswers(
  groupId: string,
  kind: ProjectRegistrationKind,
  editionId: string,
): Promise<QuestionnaireResponses | null> {
  const [row] = await db()
    .select({ responses: schema.questionnaireResponses.responses })
    .from(schema.questionnaireResponses)
    .where(
      and(
        eq(
          schema.questionnaireResponses.definitionKey,
          projectRegistrationAnswerKey(groupId, kind),
        ),
        // A project's answer key is deterministic, so without the edition this
        // would read whichever year's answers the planner happened to return.
        eq(schema.questionnaireResponses.editionId, editionId),
      ),
    )
    .orderBy(asc(schema.questionnaireResponses.id))
    .limit(1);
  return row?.responses ?? null;
}

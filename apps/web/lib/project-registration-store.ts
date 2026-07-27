import "server-only";

import { and, eq } from "drizzle-orm";
import { resolveCampAction } from "@quagga/core";
import type {
  MembershipRole,
  QuestionnaireResponses,
  RegistrationStatus,
} from "@quagga/types";
import { db, schema, withTransaction } from "./db";
import { prepareCampCreate, createCampWrites } from "./groups-store";
import { EDITABLE_STATUSES } from "./registration-store";

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

      await tx
        .insert(schema.registrations)
        .values({
          groupId,
          editionId: input.editionId,
          status: input.submit ? "submitted" : "draft",
          s1ContactEmail: input.creatorEmail,
          s2LntPlan: input.columns.lntPlan ?? null,
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
        });

      await tx
        .insert(schema.questionnaireResponses)
        .values({
          userId: input.creatorId,
          definitionKey: projectRegistrationAnswerKey(groupId, input.kind),
          definitionVersion: PROJECT_REGISTRATION_VERSION,
          responses: input.answers,
          completedAt: input.submit ? now : null,
        })
        .onConflictDoUpdate({
          target: [
            schema.questionnaireResponses.userId,
            schema.questionnaireResponses.definitionKey,
          ],
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
    .select({ status: schema.registrations.status })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, group.id),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  const status: RegistrationStatus = registration?.status ?? "draft";

  const answers = await getProjectRegistrationAnswers(group.id, kind);

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
  };
}

export interface ProjectRegistrationUpdateInput {
  groupId: string;
  editionId: string;
  kind: ProjectRegistrationKind;
  /** The editor's user id — used only when NO answer row exists yet (fallback
   * insert); an existing row is updated in place regardless of who authored it. */
  editorUserId: string;
  description: string | null;
  submit: boolean;
  columns: ProjectRegistrationColumns;
  answers: QuestionnaireResponses;
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
    return { ok: false, error: "This registration hasn't been started yet." };
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

    const [existingAnswers] = await tx
      .select({ id: schema.questionnaireResponses.id })
      .from(schema.questionnaireResponses)
      .where(eq(schema.questionnaireResponses.definitionKey, answerKey))
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
        definitionVersion: PROJECT_REGISTRATION_VERSION,
        responses: input.answers,
        completedAt: input.submit ? now : null,
      });
    }
  });

  return { ok: true, slug: current.slug };
}

/**
 * Read back a project's registration answers (the free-form half). Returns null
 * when the project never submitted this form.
 */
export async function getProjectRegistrationAnswers(
  groupId: string,
  kind: ProjectRegistrationKind,
): Promise<QuestionnaireResponses | null> {
  const [row] = await db()
    .select({ responses: schema.questionnaireResponses.responses })
    .from(schema.questionnaireResponses)
    .where(
      eq(
        schema.questionnaireResponses.definitionKey,
        projectRegistrationAnswerKey(groupId, kind),
      ),
    )
    .limit(1);
  return row?.responses ?? null;
}

import "server-only";

import { eq } from "drizzle-orm";
import type { QuestionnaireResponses } from "@quagga/types";
import { db, schema } from "./db";
import { createCamp } from "./groups-store";

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
  | { ok: true; slug: string }
  | { ok: false; error: string };

/**
 * Create the project group, its edition registration row, and its answer
 * payload in one call. Returns the new group's slug on success.
 */
export async function createProjectRegistration(
  input: ProjectRegistrationInput,
): Promise<ProjectRegistrationResult> {
  const created = await createCamp({
    creatorId: input.creatorId,
    name: input.name,
    kind: input.kind,
    description: input.description,
    // Projects start invite-only: a build crew is assembled, not walked into.
    joinability: "invite_only",
  });
  if (!created.ok) return { ok: false, error: created.error };

  const [group] = await db()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, created.slug))
    .limit(1);
  if (!group) return { ok: false, error: "Could not create the project." };

  const now = new Date();
  await db()
    .insert(schema.registrations)
    .values({
      groupId: group.id,
      editionId: input.editionId,
      status: input.submit ? "submitted" : "draft",
      s1ContactEmail: input.creatorEmail,
      s2LntPlan: input.columns.lntPlan ?? null,
      s4AreaDimensions: input.columns.areaDimensions ?? null,
      s4LayoutUploadUrls: input.columns.imageUrls,
      s5AmplifiedMusic: input.columns.soundLevel ?? null,
      s5PlacementFirstChoice: input.columns.placementNotes ?? null,
      grantsInterest: input.columns.grantsInterest ?? null,
      // `completed_sections` is the six-section CAMP wizard's progress marker —
      // it has no meaning here, so it stays empty rather than lying.
      completedSections: [],
      submittedAt: input.submit ? now : null,
    })
    .onConflictDoNothing({
      target: [schema.registrations.groupId, schema.registrations.editionId],
    });

  await db()
    .insert(schema.questionnaireResponses)
    .values({
      userId: input.creatorId,
      definitionKey: projectRegistrationAnswerKey(group.id, input.kind),
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

  return { ok: true, slug: created.slug };
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

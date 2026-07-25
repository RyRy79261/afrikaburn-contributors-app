import "server-only";

import { eq } from "drizzle-orm";
import type { QuestionnaireResponses } from "@quagga/types";

import { getDb, schema } from "@/lib/db";

// Org-local read of a project's (mutant-vehicle / artwork) free-form
// registration answers. These are authored on apps/web and stored on
// `questionnaire_responses.responses` under a project-namespaced key.
//
// WHY A DUPLICATE READ (not an import): the writer lives in
// apps/web/lib/project-registration-store.ts and we may NOT import across apps.
// What crosses the app boundary is the KEY FORMAT — `proj:<groupId>:<slug>` —
// which is the actual contract (a jsonb row shape, not a function signature).
// Re-deriving that key with the console's own db client is thinner and more
// honest than hoisting a DB read into @quagga/core (which is pure, React-free,
// I/O-free logic and has no db handle); it also matches how every other console
// read already works in lib/queries.ts.

/** The two project kinds this console renders with a kind-specific review. */
export type ProjectRegistrationKind = "mutant_vehicle" | "artwork";

const KIND_SLUG: Record<ProjectRegistrationKind, string> = {
  mutant_vehicle: "mv-registration",
  artwork: "art-registration",
};

/** Narrow an arbitrary group kind to a project kind, or null for camps/org. */
export function asProjectKind(kind: string): ProjectRegistrationKind | null {
  return kind === "mutant_vehicle" || kind === "artwork" ? kind : null;
}

/**
 * The `questionnaire_responses.definition_key` a project's answers live under.
 * Mirrors `projectRegistrationAnswerKey` in the web store — same format on both
 * sides is the contract. The group id makes it unique per project, so filtering
 * by the key alone returns the single authoring row.
 */
function projectRegistrationAnswerKey(
  groupId: string,
  kind: ProjectRegistrationKind,
): string {
  return `proj:${groupId}:${KIND_SLUG[kind]}`;
}

/**
 * Read back a project's registration answers (the kind-specific half the
 * camp-shaped `registrations` columns can't honestly hold). Null when the
 * project never authored this form. Caller must have cleared the gate.
 */
export async function getProjectRegistrationAnswers(
  groupId: string,
  kind: ProjectRegistrationKind,
): Promise<QuestionnaireResponses | null> {
  const db = getDb();
  const [row] = await db
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

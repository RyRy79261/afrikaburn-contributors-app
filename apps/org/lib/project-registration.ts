import "server-only";

import { and, asc, eq } from "drizzle-orm";
import {
  canReadPersonalInformationIn,
  safetyDocumentValidity,
  type OrgActor,
  type SafetyDocumentValidity,
} from "@quagga/core";
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
  editionId: string,
): Promise<QuestionnaireResponses | null> {
  const db = getDb();
  const [row] = await db
    .select({ responses: schema.questionnaireResponses.responses })
    .from(schema.questionnaireResponses)
    .where(
      and(
        eq(
          schema.questionnaireResponses.definitionKey,
          projectRegistrationAnswerKey(groupId, kind),
        ),
        // Per edition (migration 0020): the key is deterministic per project,
        // so an unscoped read would mix years once one exists.
        eq(schema.questionnaireResponses.editionId, editionId),
      ),
    )
    .orderBy(asc(schema.questionnaireResponses.id))
    .limit(1);
  return row?.responses ?? null;
}

/** A safety document as the review page renders it (CREATIVE-017). */
export interface ReviewSafetyDocument {
  title: string;
  url: string;
  expiresOn: string;
  validity: SafetyDocumentValidity;
}

/**
 * A registration's safety documents, or `null` when THIS viewer may not read
 * them — withheld, which the page says out loud rather than showing "none".
 *
 * The audience is org staff who read personal information in the
 * registrations domain (`canReadPersonalInformationIn`), decided BEFORE the
 * query: a certificate can carry an engineer's or a vehicle owner's details,
 * and an engineer-rank account reading the review has no reason to hold them.
 * The project's own lead/admin reads them on the web app; nobody else does.
 */
export async function getReviewSafetyDocuments(
  registrationId: string,
  actor: OrgActor,
  today: string,
): Promise<ReviewSafetyDocument[] | null> {
  if (!canReadPersonalInformationIn(actor, "registrations")) return null;
  const db = getDb();
  const rows = await db
    .select({
      title: schema.registrationSafetyDocuments.title,
      url: schema.registrationSafetyDocuments.url,
      expiresOn: schema.registrationSafetyDocuments.expiresOn,
      editionEndDate: schema.editions.endDate,
    })
    .from(schema.registrationSafetyDocuments)
    .innerJoin(
      schema.registrations,
      eq(
        schema.registrations.id,
        schema.registrationSafetyDocuments.registrationId,
      ),
    )
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(
      eq(schema.registrationSafetyDocuments.registrationId, registrationId),
    )
    .orderBy(
      asc(schema.registrationSafetyDocuments.createdAt),
      asc(schema.registrationSafetyDocuments.id),
    );
  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    expiresOn: r.expiresOn,
    validity: safetyDocumentValidity(
      r.expiresOn,
      { endDate: r.editionEndDate },
      today,
    ),
  }));
}

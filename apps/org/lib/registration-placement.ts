import "server-only";

import { and, eq, ne } from "drizzle-orm";
import {
  changedFields,
  suggestCampCode,
  type FieldChange,
} from "@quagga/core";
import { getDb, schema } from "./db";

// Console-side reads for the two R1 additions to the review screen: the
// staff-assigned placement handles and the year-on-year comparison. Kept out of
// `queries.ts` — which is already two thousand lines — and out of the actions,
// which write.
//
// NOTHING HERE READS `payments`. Registration is free (AGENTS.md §Product laws),
// so a registration has no payment to show and this screen must never grow one.

export interface PlacementContext {
  campCode: string | null;
  erf: string | null;
  /** A code derived from the camp name, avoiding this edition's taken codes. */
  suggestedCode: string;
}

/**
 * Everything the placement rail card needs for one registration.
 *
 * The suggestion is computed against the codes ALREADY TAKEN this edition, so
 * the pre-filled value in the form is one that will actually save. Computing it
 * from the name alone would offer a colliding code to every camp whose name
 * starts the same way, and the staff member would only find out on submit.
 */
export async function getPlacementContext(input: {
  registrationId: string;
  editionId: string;
  campName: string;
}): Promise<PlacementContext> {
  const db = getDb();

  const [row] = await db
    .select({
      campCode: schema.registrations.campCode,
      erf: schema.registrations.erf,
    })
    .from(schema.registrations)
    .where(eq(schema.registrations.id, input.registrationId))
    .limit(1);

  const takenRows = await db
    .select({ campCode: schema.registrations.campCode })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.editionId, input.editionId),
        ne(schema.registrations.id, input.registrationId),
      ),
    );
  const taken = takenRows
    .map((r) => r.campCode)
    .filter((c): c is string => c !== null);


  return {
    campCode: row?.campCode ?? null,
    erf: row?.erf ?? null,
    suggestedCode: suggestCampCode(input.campName, taken),
  };
}

export interface ReviewComparison {
  priorYear: number;
  currentYear: number;
  changes: FieldChange[];
}

/**
 * The year-on-year diff for a registration that was carried forward, or null
 * when it was not (a first-time camp, or one that chose to start fresh).
 *
 * Returns null rather than an empty diff when the source row has since been
 * deleted: "nothing changed" and "we can no longer tell what changed" are
 * different statements, and only the first one is safe to show a reviewer.
 */
export async function getReviewComparison(
  registration: typeof schema.registrations.$inferSelect,
  currentYear: number,
): Promise<ReviewComparison | null> {
  if (!registration.carriedForwardFromId) return null;

  const db = getDb();
  const [prior] = await db
    .select({
      row: schema.registrations,
      year: schema.editions.year,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(eq(schema.registrations.id, registration.carriedForwardFromId))
    .limit(1);
  if (!prior) return null;

  return {
    priorYear: prior.year,
    currentYear,
    changes: changedFields(prior.row, registration),
  };
}

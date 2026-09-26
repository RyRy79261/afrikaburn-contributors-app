import "server-only";

import { and, desc, eq, lt, ne } from "drizzle-orm";
import {
  changedFields,
  selectComparisonPrior,
  suggestCampCode,
  type ComparisonBasis,
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
  basis: ComparisonBasis;
  changes: FieldChange[];
}

/**
 * The year-on-year diff for a registration, or null for a first-time camp.
 *
 * WHICH PRIOR is @quagga/core `selectComparisonPrior`: the row the draft was
 * carried forward from when there is one, otherwise the camp's most recent
 * SUBMITTED earlier edition (epic #50 — the diff used to exist only for
 * carried-forward drafts, so a returning camp that typed its answers fresh gave
 * the reviewer nothing to compare). The camp's own "what changed" view reads the
 * same function, so both sides see one diff.
 *
 * Returns null rather than an empty diff when there is no usable prior (a
 * first-timer, or a carried source since deleted with no submitted earlier
 * edition to fall back to): "nothing changed" and "we can no longer tell what
 * changed" are different statements, and only the first is safe to show.
 */
export async function getReviewComparison(
  registration: typeof schema.registrations.$inferSelect,
  currentYear: number,
): Promise<ReviewComparison | null> {
  const db = getDb();
  // One camp has one row per edition — a handful of rows, whole, in one trip.
  const rows = await db
    .select({
      row: schema.registrations,
      year: schema.editions.year,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(
      and(
        eq(schema.registrations.groupId, registration.groupId),
        lt(schema.editions.year, currentYear),
      ),
    )
    .orderBy(desc(schema.editions.year));

  const picked = selectComparisonPrior({
    current: {
      groupId: registration.groupId,
      editionYear: currentYear,
      carriedForwardFromId: registration.carriedForwardFromId,
    },
    candidates: rows.map((r) => ({
      registrationId: r.row.id,
      groupId: r.row.groupId,
      editionYear: r.year,
      submittedAt: r.row.submittedAt,
      status: r.row.status,
      row: r.row,
    })),
  });
  if (!picked) return null;

  return {
    priorYear: picked.prior.editionYear,
    currentYear,
    basis: picked.basis,
    changes: changedFields(picked.prior.row, registration),
  };
}

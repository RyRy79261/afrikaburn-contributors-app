import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  buildPlacementCsv,
  placementCsvFilename,
  publicMemberName,
  type PlacementExportRow,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { getActiveEdition } from "@/lib/queries";
import { requireOrgSession } from "@/lib/session";

// The placement export (roadmap R1: "export for placement").
//
// Placement happens off-platform — a room, a printed map, and the people who
// decide which camp goes where. This hands them one spreadsheet of the active
// edition's camps with the numbers the decision actually turns on.
//
// A ROUTE RATHER THAN A SERVER ACTION because the product is a FILE. A server
// action returning a 200KB string that the client turns into a Blob is a
// download reimplemented badly; a route sets Content-Disposition and the browser
// does the rest.
//
// WHAT IS NOT IN THE FILE is the important part, and it is enforced one layer
// down: @quagga/core `registration-export` has no column for a phone number, an
// ID number, an emergency contact or a medical note, and a test asserts that it
// never grows one. A placement spreadsheet gets mailed around and left in
// downloads folders; it is the worst possible container for hard-locked data and
// none of it helps anyone place a camp.
//
// AUTHORISED AS `read` ON `registrations` — the same capability as opening the
// review screen this data is already visible on. Exporting is not a new
// permission, it is the same reader taking the same rows away with them.

export const dynamic = "force-dynamic";

/** Only camps that are actually in the running get placed. */
const EXPORTABLE_STATUSES = [
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
] as const;

export async function GET(): Promise<NextResponse> {
  await requireOrgSession({ capability: "read", domain: "registrations" });

  const edition = await getActiveEdition();
  if (!edition) {
    return NextResponse.json(
      { ok: false, error: "No active edition is seeded." },
      { status: 503 },
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      registrationId: schema.registrations.id,
      campName: schema.groups.name,
      campCode: schema.registrations.campCode,
      erf: schema.registrations.erf,
      status: schema.registrations.status,
      contactEmail: schema.registrations.s1ContactEmail,
      expectedPopulation: schema.registrations.s4ExpectedPopulation,
      areaDimensions: schema.registrations.s4AreaDimensions,
      workAccessPasses: schema.registrations.s4WorkAccessPasses,
      firstArrivalDate: schema.registrations.s4FirstArrivalDate,
      amplifiedMusic: schema.registrations.s5AmplifiedMusic,
      placementFirstChoice: schema.registrations.s5PlacementFirstChoice,
      placementSecondChoice: schema.registrations.s5PlacementSecondChoice,
      neighbourRequest: schema.registrations.s5NeighbourRequest,
      familyFriendly: schema.registrations.s5FamilyFriendly,
      submittedAt: schema.registrations.submittedAt,
      wranglerUsername: schema.users.username,
      wranglerSanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.registrations)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.registrations.groupId))
    // Wrangler is optional, so both joins are left joins — an unassigned camp
    // must still appear in the file, blank column and all.
    .leftJoin(
      schema.wranglerAssignments,
      and(
        eq(schema.wranglerAssignments.groupId, schema.registrations.groupId),
        eq(
          schema.wranglerAssignments.editionId,
          schema.registrations.editionId,
        ),
      ),
    )
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.wranglerAssignments.wranglerUserId),
    )
    .where(
      and(
        eq(schema.registrations.editionId, edition.id),
        inArray(schema.registrations.status, [...EXPORTABLE_STATUSES]),
      ),
    )
    .orderBy(asc(schema.groups.name));

  // Categories are many-to-many, so they are fetched once and grouped rather
  // than joined into the row query — a join would multiply every camp by its
  // category count and quietly duplicate camps in the spreadsheet.
  const categoryRows =
    rows.length === 0
      ? []
      : await db
          .select({
            registrationId: schema.registrations.id,
            label: schema.campCategories.label,
          })
          .from(schema.groupCategories)
          .innerJoin(
            schema.campCategories,
            eq(schema.campCategories.id, schema.groupCategories.categoryId),
          )
          .innerJoin(
            schema.registrations,
            eq(schema.registrations.groupId, schema.groupCategories.groupId),
          )
          .where(
            inArray(
              schema.registrations.id,
              rows.map((r) => r.registrationId),
            ),
          )
          .orderBy(asc(schema.campCategories.sort));

  const categoriesByRegistration = new Map<string, string[]>();
  for (const row of categoryRows) {
    const list = categoriesByRegistration.get(row.registrationId) ?? [];
    list.push(row.label);
    categoriesByRegistration.set(row.registrationId, list);
  }

  const exportRows: PlacementExportRow[] = rows.map((row) => ({
    campName: row.campName,
    campCode: row.campCode,
    erf: row.erf,
    status: row.status,
    categories: categoriesByRegistration.get(row.registrationId) ?? null,
    contactEmail: row.contactEmail,
    expectedPopulation: row.expectedPopulation,
    areaDimensions: row.areaDimensions,
    workAccessPasses: row.workAccessPasses,
    firstArrivalDate: row.firstArrivalDate,
    amplifiedMusic: row.amplifiedMusic,
    placementFirstChoice: row.placementFirstChoice,
    placementSecondChoice: row.placementSecondChoice,
    neighbourRequest: row.neighbourRequest,
    familyFriendly: row.familyFriendly,
    wranglerName: row.wranglerUsername
      ? publicMemberName(row.wranglerUsername, {
          sanitizedAt: row.wranglerSanitizedAt,
        })
      : null,
    submittedAt: row.submittedAt,
  }));

  const csv = buildPlacementCsv(exportRows);
  const filename = placementCsvFilename(edition.year, new Date());

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // This file is a snapshot of a moving review queue; a cached copy is a
      // stale placement decision.
      "Cache-Control": "no-store",
    },
  });
}

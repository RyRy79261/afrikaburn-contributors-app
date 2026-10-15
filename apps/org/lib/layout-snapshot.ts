import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  boundaryDimensions,
  canOrgViewLayoutSnapshot,
  getLayoutCatalog,
  plotSummary,
  type OrgActor,
} from "@quagga/core";
import { LayoutBoundary, LayoutDocument } from "@quagga/types";
import { getDb, schema } from "./db";

// The camp layout AfrikaBurn's reviewers see (docs/camp-layout-spec.md
// decision 10): the SNAPSHOT pinned when the camp submitted or resubmitted
// its registration — never the working document, which the camp keeps
// editing. Later edits reach the console only when the camp resubmits.
//
// WHO. The registration-read capability the console already has
// (`canOrgViewLayoutSnapshot`); nothing new is granted or audited. Refused
// before any query runs.
//
// WHAT. The document, its version and when it was pinned. NOT who pinned it
// (a camp member's account, which this screen has no need to name) and NOT
// the warnings: those are for the camp's editors only (14 Oct decision), so
// none is computed here.
//
// The stored document is parsed again on the way out: a row that no longer
// parses is shown as "no snapshot", never drawn half-formed.

export interface LayoutSnapshotForReview {
  version: number;
  pinnedAt: Date;
  document: LayoutDocument;
  summary: {
    width: number;
    depth: number;
    areaM2: number;
    totalObjectCount: number;
  };
}

/**
 * The registration's most recently pinned layout, with its plot summary.
 * Null when the actor may not see it, nothing is pinned, or the stored
 * document no longer parses.
 */
export async function getLayoutSnapshotForReview(
  registrationId: string,
  editionYear: number,
  actor: OrgActor,
): Promise<LayoutSnapshotForReview | null> {
  if (!canOrgViewLayoutSnapshot(actor)) return null;
  const [row] = await getDb()
    .select({
      version: schema.campLayoutSnapshots.version,
      pinnedAt: schema.campLayoutSnapshots.pinnedAt,
      document: schema.campLayoutSnapshots.document,
    })
    .from(schema.campLayoutSnapshots)
    .where(eq(schema.campLayoutSnapshots.registrationId, registrationId))
    .orderBy(desc(schema.campLayoutSnapshots.pinnedAt))
    .limit(1);
  if (!row) return null;
  const parsed = LayoutDocument.safeParse(row.document);
  if (!parsed.success) return null;
  const s = plotSummary(parsed.data, getLayoutCatalog(editionYear));
  return {
    version: row.version,
    pinnedAt: row.pinnedAt,
    document: parsed.data,
    summary: {
      width: s.width,
      depth: s.depth,
      areaM2: s.areaM2,
      totalObjectCount: s.totalObjectCount,
    },
  };
}

/** A pinned layout's plot, as the placement CSV carries it. */
export interface PinnedLayoutPlot {
  width: number;
  depth: number;
  areaM2: number;
}

/**
 * The placement CSV's plot size and area (decision 10: "add only the plot
 * dimensions and area, never the layout itself"), from the LATEST snapshot
 * pinned for each registration. Same capability as the review screen; an
 * account without it gets an empty map before any query runs. A registration
 * with no pin, or one whose stored document no longer parses, is absent.
 *
 * Latest is chosen here by `pinnedAt`, not trusted to the ORDER BY alone, so
 * an older pin can never stand in for the one the camp resubmitted with.
 */
export async function getPinnedLayoutPlots(
  registrationIds: readonly string[],
  actor: OrgActor,
): Promise<Map<string, PinnedLayoutPlot>> {
  const out = new Map<string, PinnedLayoutPlot>();
  if (!canOrgViewLayoutSnapshot(actor) || registrationIds.length === 0) {
    return out;
  }
  // One row per registration (its latest pin), and only the plot boundary:
  // the CSV needs width, depth and area, never the objects. A document can be
  // 256 kB and every resubmit pins another, so the full history would be
  // megabytes per export.
  const rows = await getDb()
    .selectDistinctOn([schema.campLayoutSnapshots.registrationId], {
      registrationId: schema.campLayoutSnapshots.registrationId,
      pinnedAt: schema.campLayoutSnapshots.pinnedAt,
      boundary: sql<unknown>`${schema.campLayoutSnapshots.document}->'plot'->'boundary'`,
    })
    .from(schema.campLayoutSnapshots)
    .where(
      inArray(schema.campLayoutSnapshots.registrationId, [...registrationIds]),
    )
    .orderBy(
      schema.campLayoutSnapshots.registrationId,
      desc(schema.campLayoutSnapshots.pinnedAt),
    );

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const seen = latest.get(row.registrationId);
    if (!seen || row.pinnedAt > seen.pinnedAt) {
      latest.set(row.registrationId, row);
    }
  }
  for (const [registrationId, row] of latest) {
    const parsed = LayoutBoundary.safeParse(row.boundary);
    if (!parsed.success) continue;
    const s = boundaryDimensions(parsed.data);
    out.set(registrationId, {
      width: s.width,
      depth: s.depth,
      areaM2: s.areaM2,
    });
  }
  return out;
}

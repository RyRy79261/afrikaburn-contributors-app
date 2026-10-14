import "server-only";

import { desc, eq } from "drizzle-orm";
import {
  canOrgViewLayoutSnapshot,
  getLayoutCatalog,
  plotSummary,
  type OrgActor,
} from "@quagga/core";
import { LayoutDocument } from "@quagga/types";
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

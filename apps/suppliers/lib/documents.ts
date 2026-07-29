import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { SupplierOnboardingStepKey } from "@quagga/types";
import {
  buildDocumentViews,
  deriveDocumentAckProgress,
  type SupplierDocument,
  type SupplierDocumentAck,
  type SupplierDocumentView,
  type DocumentAckProgress,
} from "@quagga/core";

import { getDb, schema, type DbOrTx } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// Read side of the supplier Documents panel (docs/accounts-security-spec.md
// §"Supplier documents"). The org CRUDs the per-edition list in the console;
// this loads it for the signed-in supplier along with their acknowledgements.
//
// Never throws — an unconfigured DB or a query failure returns an empty panel so
// the onboarding page keeps rendering (the env-less boot rule).

export interface SupplierDocumentsPanelData {
  views: SupplierDocumentView[];
  progress: DocumentAckProgress;
}

/** Empty panel — the graceful state used whenever we can't read. */
const EMPTY: SupplierDocumentsPanelData = {
  views: [],
  progress: { acked: 0, required: 0, allAcknowledged: true, outstanding: [] },
};

/**
 * The edition's documents, in catalog order. `stepKey` is stored as plain text
 * (mirroring `supplier_onboarding.steps` keys) and narrowed here — an unknown
 * key from a future catalog change degrades to "unbound" rather than crashing
 * the panel.
 */
export async function listEditionDocuments(
  editionId: string,
): Promise<SupplierDocument[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await getDb()
      .select({
        id: schema.supplierDocuments.id,
        title: schema.supplierDocuments.title,
        sourceType: schema.supplierDocuments.sourceType,
        url: schema.supplierDocuments.url,
        requiredAck: schema.supplierDocuments.requiredAck,
        stepKey: schema.supplierDocuments.stepKey,
        sort: schema.supplierDocuments.sort,
      })
      .from(schema.supplierDocuments)
      .where(eq(schema.supplierDocuments.editionId, editionId))
      .orderBy(
        asc(schema.supplierDocuments.sort),
        asc(schema.supplierDocuments.title),
      );
    return rows.map((r) => ({
      ...r,
      stepKey: (r.stepKey as SupplierOnboardingStepKey | null) ?? null,
    }));
  } catch {
    return [];
  }
}

/** This supplier's acknowledgements for the edition's documents. */
export async function listSupplierAcks(
  supplierId: string,
  documentIds: readonly string[],
): Promise<SupplierDocumentAck[]> {
  if (!isDatabaseConfigured() || documentIds.length === 0) return [];
  try {
    const rows = await getDb()
      .select({
        documentId: schema.supplierDocumentAcks.documentId,
        ackedAt: schema.supplierDocumentAcks.ackedAt,
      })
      .from(schema.supplierDocumentAcks)
      .where(eq(schema.supplierDocumentAcks.supplierId, supplierId));
    const known = new Set(documentIds);
    return rows.filter((r) => known.has(r.documentId));
  } catch {
    return [];
  }
}

/**
 * Everything the Documents panel needs. An edition with no documents returns an
 * empty `views` array, which is exactly how the onboarding page decides not to
 * render the panel at all — no empty card, no dead heading.
 */
export async function loadSupplierDocumentsPanel(
  supplierId: string,
  editionId: string,
): Promise<SupplierDocumentsPanelData> {
  const documents = await listEditionDocuments(editionId);
  if (documents.length === 0) return EMPTY;
  const acks = await listSupplierAcks(
    supplierId,
    documents.map((d) => d.id),
  );
  return {
    views: buildDocumentViews(documents, acks),
    progress: deriveDocumentAckProgress(documents, acks),
  };
}

/**
 * Load documents + acks as the raw pair the ack action needs to reconcile
 * onboarding steps (`applyDocumentAcksToSteps`). Separate from the panel loader
 * because the action needs the un-joined values, and because it must NOT swallow
 * errors — a write path that silently reconciles against an empty document list
 * would wrongly revert completed steps.
 *
 * Accepts an explicit db/tx so the ack action can reconcile INSIDE its
 * transaction — reading its own just-written (uncommitted) ack row, which a
 * separate HTTP connection could not see. Defaults to the HTTP db otherwise.
 */
export async function loadDocumentsForReconcile(
  supplierId: string,
  editionId: string,
  db: DbOrTx = getDb(),
): Promise<{ documents: SupplierDocument[]; acks: SupplierDocumentAck[] }> {
  const rows = await db
    .select({
      id: schema.supplierDocuments.id,
      title: schema.supplierDocuments.title,
      sourceType: schema.supplierDocuments.sourceType,
      url: schema.supplierDocuments.url,
      requiredAck: schema.supplierDocuments.requiredAck,
      stepKey: schema.supplierDocuments.stepKey,
      sort: schema.supplierDocuments.sort,
    })
    .from(schema.supplierDocuments)
    .where(eq(schema.supplierDocuments.editionId, editionId));

  const documents: SupplierDocument[] = rows.map((r) => ({
    ...r,
    stepKey: (r.stepKey as SupplierOnboardingStepKey | null) ?? null,
  }));

  const ackRows = await db
    .select({
      documentId: schema.supplierDocumentAcks.documentId,
      ackedAt: schema.supplierDocumentAcks.ackedAt,
    })
    .from(schema.supplierDocumentAcks)
    .where(eq(schema.supplierDocumentAcks.supplierId, supplierId));

  const known = new Set(documents.map((d) => d.id));
  return { documents, acks: ackRows.filter((a) => known.has(a.documentId)) };
}

/**
 * The acknowledgement-carrying documents bound to one onboarding step, for one
 * edition — i.e. the documents `applyDocumentAcksToSteps` reconciles that step
 * against, and therefore the only thing that may complete it.
 *
 * Unlike the panel loaders above, this deliberately does NOT swallow errors. It
 * guards a write, and a swallowed failure would fail OPEN — returning "nothing
 * is bound" is precisely the bypass it exists to close.
 */
export async function requiredDocumentsBoundToStep(
  editionId: string,
  stepKey: SupplierOnboardingStepKey,
  db: DbOrTx = getDb(),
): Promise<SupplierDocument[]> {
  const rows = await db
    .select({
      id: schema.supplierDocuments.id,
      title: schema.supplierDocuments.title,
      sourceType: schema.supplierDocuments.sourceType,
      url: schema.supplierDocuments.url,
      requiredAck: schema.supplierDocuments.requiredAck,
      stepKey: schema.supplierDocuments.stepKey,
      sort: schema.supplierDocuments.sort,
    })
    .from(schema.supplierDocuments)
    .where(
      and(
        eq(schema.supplierDocuments.editionId, editionId),
        eq(schema.supplierDocuments.stepKey, stepKey),
        eq(schema.supplierDocuments.requiredAck, true),
      ),
    )
    .orderBy(
      asc(schema.supplierDocuments.sort),
      asc(schema.supplierDocuments.title),
    );
  return rows.map((r) => ({
    ...r,
    stepKey: (r.stepKey as SupplierOnboardingStepKey | null) ?? null,
  }));
}

/**
 * Confirm a document belongs to the supplier's own edition before acting on it.
 * Server-side authz: a forged document id from another edition must not create
 * an acknowledgement row.
 */
export async function documentBelongsToEdition(
  documentId: string,
  editionId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.supplierDocuments.id })
    .from(schema.supplierDocuments)
    .where(
      and(
        eq(schema.supplierDocuments.id, documentId),
        eq(schema.supplierDocuments.editionId, editionId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

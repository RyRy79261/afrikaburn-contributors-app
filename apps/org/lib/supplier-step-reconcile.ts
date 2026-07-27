import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import {
  applyDocumentAcksToSteps,
  type SupplierDocument,
  type SupplierDocumentAck,
} from "@quagga/core";
import type {
  SupplierOnboardingStepKey,
  SupplierOnboardingSteps,
} from "@quagga/types";

import { schema } from "@/lib/db";
import type { OrgTx } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

// Reconcile supplier onboarding steps after the ORG changes the document list.
//
// THE BUG THIS EXISTS FOR (audit M17). `supplier_onboarding.steps` was only ever
// recomputed inside the SUPPLIER'S OWN acknowledgement action. The org console
// could add, rebind or delete a document and nothing recalculated anything — so
// the console kept reporting "signed" for a document that had been withdrawn,
// and missed a newly added required document that nobody had signed. Two
// docstrings asserted a reconciliation that no code performed. At a depot that
// is a truck waved through on a signature for a document that does not exist.
//
// WHY EVERY SUPPLIER IN THE EDITION, not just the ones who acked the changed
// document. Consider documents A and B both required and bound to the same
// step, and a supplier who acked only B: their step is `pending`. The org
// deletes A. B is now the only required document bound to that step, and it IS
// acknowledged — so the step should COMPLETE. That supplier never touched A, so
// an ack-holders-only sweep would skip them and leave the step wrong in the
// other direction. The set of suppliers a document change can affect is not the
// set who acknowledged it.
//
// Supplier counts are in the hundreds and org document edits are rare, so a
// whole-edition sweep is the cheap, obviously-correct option.

/** A step that moved backwards for a supplier — they must be told. */
export interface ReopenedStep {
  supplierId: string;
  /** The supplier's linked account, or null for an unclaimed listing. */
  userId: string | null;
  supplierName: string;
  stepKey: SupplierOnboardingStepKey;
}

export interface ReconcileResult {
  /** Suppliers whose step map changed at all. */
  changed: number;
  /** Steps that moved from completed back to pending, per supplier. */
  reopened: ReopenedStep[];
}

/**
 * Recompute every supplier's document-driven steps for one edition.
 *
 * MUST run inside the same transaction as the document write, on the same `tx`
 * handle: it has to read the document list AS CHANGED, and a separate HTTP
 * connection cannot see an uncommitted delete.
 *
 * @param alsoConsider Steps to re-evaluate even with no document bound to them
 *   now — the step a deleted or rebound document used to carry. Without it a
 *   step whose last document vanished is never looked at and keeps a stale
 *   `completed`.
 */
export async function reconcileEditionSupplierSteps(
  tx: OrgTx,
  editionId: string,
  alsoConsider: readonly SupplierOnboardingStepKey[] = [],
  actorId: string,
): Promise<ReconcileResult> {
  // The document list as it now stands, inside this transaction.
  const docRows = await tx
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

  const documents: SupplierDocument[] = docRows.map((r) => ({
    ...r,
    stepKey: (r.stepKey as SupplierOnboardingStepKey | null) ?? null,
  }));
  const liveDocumentIds = new Set(documents.map((d) => d.id));

  // Every supplier with an onboarding row for this edition.
  const onboarding = await tx
    .select({
      supplierId: schema.supplierOnboarding.supplierId,
      steps: schema.supplierOnboarding.steps,
      supplierName: schema.suppliers.name,
      userId: schema.suppliers.userId,
    })
    .from(schema.supplierOnboarding)
    .innerJoin(
      schema.suppliers,
      eq(schema.suppliers.id, schema.supplierOnboarding.supplierId),
    )
    .where(eq(schema.supplierOnboarding.editionId, editionId));

  if (onboarding.length === 0) return { changed: 0, reopened: [] };

  // All acks for those suppliers in one read rather than one query per supplier.
  const ackRows = await tx
    .select({
      supplierId: schema.supplierDocumentAcks.supplierId,
      documentId: schema.supplierDocumentAcks.documentId,
      ackedAt: schema.supplierDocumentAcks.ackedAt,
    })
    .from(schema.supplierDocumentAcks)
    .where(
      inArray(
        schema.supplierDocumentAcks.supplierId,
        onboarding.map((o) => o.supplierId),
      ),
    );

  const acksBySupplier = new Map<string, SupplierDocumentAck[]>();
  for (const ack of ackRows) {
    // An ack whose document is gone is not evidence of anything. Deletes
    // cascade the ack rows away anyway; this guards the read-your-own-write
    // window and any historical orphan.
    if (!liveDocumentIds.has(ack.documentId)) continue;
    const list = acksBySupplier.get(ack.supplierId) ?? [];
    list.push({ documentId: ack.documentId, ackedAt: ack.ackedAt });
    acksBySupplier.set(ack.supplierId, list);
  }

  const reopened: ReopenedStep[] = [];
  let changed = 0;

  for (const row of onboarding) {
    const result = applyDocumentAcksToSteps(
      row.steps as SupplierOnboardingSteps | null,
      documents,
      acksBySupplier.get(row.supplierId) ?? [],
      alsoConsider,
    );
    if (result.completed.length === 0 && result.reverted.length === 0) continue;

    changed += 1;
    await tx
      .update(schema.supplierOnboarding)
      .set({ steps: result.steps, updatedAt: new Date() })
      .where(
        and(
          eq(schema.supplierOnboarding.supplierId, row.supplierId),
          eq(schema.supplierOnboarding.editionId, editionId),
        ),
      );

    // Audited because it is a state change nobody asked for directly: the
    // supplier did not act, the org's document edit moved their checklist.
    for (const stepKey of result.reverted) {
      reopened.push({
        supplierId: row.supplierId,
        userId: row.userId,
        supplierName: row.supplierName,
        stepKey,
      });
      await writeAuditEvent(tx, {
        actorId,
        action: "supplier.onboarding_step_reopened",
        subject: row.supplierId,
        meta: { stepKey, cause: "document_change" },
      });
    }
    for (const stepKey of result.completed) {
      await writeAuditEvent(tx, {
        actorId,
        action: "supplier.onboarding_step",
        subject: row.supplierId,
        meta: { stepKey, status: "completed", cause: "document_change" },
      });
    }
  }

  return { changed, reopened };
}

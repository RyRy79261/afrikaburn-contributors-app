"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { applyDocumentAcksToSteps } from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { requireSupplierSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import {
  documentBelongsToEdition,
  loadDocumentsForReconcile,
} from "@/lib/documents";
import { runAction, type ActionResult } from "./result";

// Supplier-side acknowledgement of an org-published document
// (docs/accounts-security-spec.md §"Supplier documents"). Acknowledging the last
// outstanding document bound to an onboarding step COMPLETES that step; undoing
// an acknowledgement reverts it. Both directions run through
// `applyDocumentAcksToSteps` in @quagga/core, which re-applies the org-confirmed
// guard — a document can never complete a step only AfrikaBurn may confirm.

const SetAckInput = z.object({
  documentId: z.string().uuid(),
  acknowledged: z.boolean(),
});

/**
 * Acknowledge (or withdraw acknowledgement of) a supplier document.
 *
 * Server-side authz, every time:
 *  - `requireSupplierSession` re-resolves the signed-in supplier; the client
 *    never supplies a supplier id;
 *  - the document must belong to the supplier's OWN active edition, so a forged
 *    id from another edition writes nothing;
 *  - the ack row is keyed (supplierId, documentId), so a replayed request is
 *    idempotent rather than duplicative.
 *
 * The step reconciliation runs afterwards from the RE-READ state, never from
 * anything the client sent.
 */
export async function setDocumentAcknowledgement(
  raw: z.input<typeof SetAckInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSupplierSession();
    const input = SetAckInput.parse(raw);

    const db = getDb();

    if (!(await documentBelongsToEdition(input.documentId, session.edition.id))) {
      throw new Error("That document isn't part of this edition.");
    }

    if (input.acknowledged) {
      await db
        .insert(schema.supplierDocumentAcks)
        .values({
          supplierId: session.supplier.id,
          documentId: input.documentId,
        })
        .onConflictDoNothing({
          target: [
            schema.supplierDocumentAcks.supplierId,
            schema.supplierDocumentAcks.documentId,
          ],
        });
    } else {
      await db
        .delete(schema.supplierDocumentAcks)
        .where(
          and(
            eq(schema.supplierDocumentAcks.supplierId, session.supplier.id),
            eq(schema.supplierDocumentAcks.documentId, input.documentId),
          ),
        );
    }

    // Reconcile bound onboarding steps against the acknowledgements as they now
    // stand. Read AFTER the write so the decision is made on committed state.
    const { documents, acks } = await loadDocumentsForReconcile(
      session.supplier.id,
      session.edition.id,
    );
    const reconciled = applyDocumentAcksToSteps(session.steps, documents, acks);

    if (reconciled.completed.length > 0 || reconciled.reverted.length > 0) {
      await db
        .update(schema.supplierOnboarding)
        .set({ steps: reconciled.steps, updatedAt: new Date() })
        .where(
          and(
            eq(schema.supplierOnboarding.supplierId, session.supplier.id),
            eq(schema.supplierOnboarding.editionId, session.edition.id),
          ),
        );

      for (const stepKey of reconciled.completed) {
        await writeAuditEvent(db, {
          actorId: session.dbUserId,
          action: "supplier.onboarding_step",
          subject: session.supplier.id,
          meta: {
            step: stepKey,
            to: "completed",
            via: "document_ack",
            edition: session.edition.year,
          },
        });
      }
      for (const stepKey of reconciled.reverted) {
        await writeAuditEvent(db, {
          actorId: session.dbUserId,
          action: "supplier.onboarding_step",
          subject: session.supplier.id,
          meta: {
            step: stepKey,
            to: "pending",
            via: "document_ack_withdrawn",
            edition: session.edition.year,
          },
        });
      }
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.document_ack",
      subject: session.supplier.id,
      meta: {
        documentId: input.documentId,
        acknowledged: input.acknowledged,
        stepsCompleted: reconciled.completed,
        stepsReverted: reconciled.reverted,
        edition: session.edition.year,
      },
    });

    revalidatePath("/onboarding");
  });
}

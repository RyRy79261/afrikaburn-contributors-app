"use server";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { SupplierDocumentInput } from "@quagga/types";
import {
  supplierOnboardingStep,
  supplierStepReopenedNotification,
  validateDocumentBinding,
} from "@quagga/core";
import type { SupplierOnboardingStepKey } from "@quagga/types";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import {
  reconcileEditionSupplierSteps,
  type ReopenedStep,
} from "@/lib/supplier-step-reconcile";
import { runAction, type ActionResult } from "./result";

// Org CRUD for the per-edition supplier document list
// (docs/accounts-security-spec.md §"Supplier documents — org-controlled", the
// console's "Supplier sign-up management" section). Org-only, server-side authz
// via `requireOrgSession`; every write validates through @quagga/core and is
// audited.
//
// The rule the validation exists for: a document may only BIND to an onboarding
// step the supplier completes themselves. Binding to deposit / briefing /
// registration fee is rejected — a supplier ticking a checkbox must never be
// able to confirm that money arrived or that they attended a briefing.

/**
 * Tell each supplier whose checklist moved BACKWARDS. Silently un-ticking a step
 * they had signed off would leave them staring at an unexplained regression;
 * leaving it ticked would leave the console lying. So: revert, and say why.
 *
 * Best-effort and post-commit — the reconciliation has already happened and must
 * not be rolled back over an inbox write. Unclaimed listings (no linked account)
 * have nobody to notify.
 */
async function notifyReopened(reopened: readonly ReopenedStep[]): Promise<void> {
  const rows = reopened
    .filter((r): r is ReopenedStep & { userId: string } => r.userId !== null)
    .map((r) => ({
      userId: r.userId,
      ...supplierStepReopenedNotification({
        stepLabel: supplierOnboardingStep(r.stepKey)?.title ?? r.stepKey,
      }),
      origin: "org" as const,
      linkApp: "suppliers" as const,
    }));
  if (rows.length === 0) return;
  try {
    await insertNotifications(getDb(), rows);
  } catch (err) {
    console.error("[supplier-documents] reopened notification failed", err);
  }
}

const CreateDocumentInput = SupplierDocumentInput.extend({
  editionId: z.string().uuid(),
});

/** Publish a document/link for an edition. Org-only. Audited. */
export async function createSupplierDocument(
  raw: z.input<typeof CreateDocumentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "write" });
    const { editionId, ...input } = CreateDocumentInput.parse(raw);

    const binding = validateDocumentBinding(input.stepKey, input.requiredAck);
    if (!binding.ok) throw new Error(binding.reason);

    // Sort computation, insert, reconcile and audit are one atomic unit.
    let reopened: ReopenedStep[] = [];
    await withTransaction(async (tx) => {
      // Default sort to the end of the edition's list when not supplied.
      let sort = input.sort;
      if (sort == null) {
        const [{ max } = { max: null }] = await tx
          .select({
            max: sql<number | null>`max(${schema.supplierDocuments.sort})`,
          })
          .from(schema.supplierDocuments)
          .where(eq(schema.supplierDocuments.editionId, editionId));
        sort = max == null ? 0 : Number(max) + 1;
      }

      const [created] = await tx
        .insert(schema.supplierDocuments)
        .values({
          editionId,
          title: input.title,
          sourceType: input.sourceType,
          url: input.url,
          requiredAck: input.requiredAck,
          stepKey: input.stepKey,
          sort,
          createdByUserId: session.dbUserId,
        })
        .returning({ id: schema.supplierDocuments.id });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier_document.create",
        subject: created?.id,
        meta: {
          editionId,
          title: input.title,
          sourceType: input.sourceType,
          requiredAck: input.requiredAck,
          stepKey: input.stepKey,
        },
      });

      // A new REQUIRED document bound to a step re-opens that step for every
      // supplier who had already signed off on the old set. Reconciling here,
      // in the same transaction, is what stops the console reporting them as
      // signed for a document they have never seen.
      reopened = (
        await reconcileEditionSupplierSteps(
          tx,
          editionId,
          [],
          session.dbUserId,
        )
      ).reopened;
    });

    await notifyReopened(reopened);
    revalidatePath("/suppliers");
    revalidatePath("/suppliers/signup-management");
  });
}

const UpdateDocumentInput = SupplierDocumentInput.extend({
  documentId: z.string().uuid(),
});

/**
 * Edit a document. Audited.
 *
 * Editing is consequential beyond this table: adding `requiredAck` to a document
 * bound to a step, or binding an existing unacknowledged document to a step,
 * legitimately RE-OPENS that step for suppliers who had it complete. REBINDING
 * a document away from a step can also leave the OLD step with no evidence
 * behind it.
 *
 * This docstring used to claim that reconciliation "happens on the supplier's
 * next ack (or page load)" and that there was "no stale completed to clean up
 * here". Both halves were false (audit M17): `applyDocumentAcksToSteps` had
 * exactly one caller — the supplier's own ack action — so a supplier who never
 * acked again was never reconciled, and a step whose documents had all moved
 * away was not even in the reconcile set. It is reconciled HERE now, in the same
 * transaction, for every supplier in the edition, considering both the step the
 * document used to carry and the one it carries now.
 */
export async function updateSupplierDocument(
  raw: z.input<typeof UpdateDocumentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "write" });
    const { documentId, ...input } = UpdateDocumentInput.parse(raw);

    const binding = validateDocumentBinding(input.stepKey, input.requiredAck);
    if (!binding.ok) throw new Error(binding.reason);

    // Read, update, reconcile and audit are one atomic unit.
    let reopened: ReopenedStep[] = [];
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          id: schema.supplierDocuments.id,
          sort: schema.supplierDocuments.sort,
          editionId: schema.supplierDocuments.editionId,
          stepKey: schema.supplierDocuments.stepKey,
        })
        .from(schema.supplierDocuments)
        .where(eq(schema.supplierDocuments.id, documentId))
        .limit(1);
      if (!current) throw new Error("That document no longer exists.");

      await tx
        .update(schema.supplierDocuments)
        .set({
          title: input.title,
          sourceType: input.sourceType,
          url: input.url,
          requiredAck: input.requiredAck,
          stepKey: input.stepKey,
          sort: input.sort ?? current.sort,
          updatedAt: new Date(),
        })
        .where(eq(schema.supplierDocuments.id, documentId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier_document.update",
        subject: documentId,
        meta: {
          title: input.title,
          requiredAck: input.requiredAck,
          stepKey: input.stepKey,
        },
      });

      // BOTH steps: the one it now carries (covered automatically) and the one
      // it used to carry. A rebind that empties the old step's binding must
      // re-open it, and only `alsoConsider` puts a step with no documents left
      // back into the reconcile set.
      const touched = [current.stepKey, input.stepKey].filter(
        (k): k is SupplierOnboardingStepKey => Boolean(k),
      );
      reopened = (
        await reconcileEditionSupplierSteps(
          tx,
          current.editionId,
          touched,
          session.dbUserId,
        )
      ).reopened;
    });

    await notifyReopened(reopened);
    revalidatePath("/suppliers");
    revalidatePath("/suppliers/signup-management");
  });
}

const DeleteDocumentInput = z.object({ documentId: z.string().uuid() });

/**
 * Withdraw a document. Its acknowledgements cascade away with it — which is
 * correct: an acknowledgement of a document that no longer exists is not
 * evidence of anything. The ack count is captured for the audit trail first,
 * because that is the only place it survives.
 *
 * AND THE STEP IS RECONCILED. Cascading the acks away used to leave the step
 * map untouched, so a step whose only required document had just been deleted
 * stayed `completed` forever — the console reporting a supplier as signed for
 * something that no longer existed (audit M17). The deleted document's step is
 * passed as `alsoConsider` precisely because it may now have no documents bound
 * to it at all, which is exactly the case the reconcile set used to skip.
 */
export async function deleteSupplierDocument(
  raw: z.input<typeof DeleteDocumentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    // Its own domain, not `suppliers`: the document library and the supplier
    // repository are separate parts of the console and an org may well give
    // them to different departments.
    const session = await requireOrgSession({
      capability: "delete",
      domain: "supplier_documents",
    });
    const { documentId } = DeleteDocumentInput.parse(raw);

    // Read, ack-count, delete, reconcile and audit are one atomic unit.
    let reopened: ReopenedStep[] = [];
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          title: schema.supplierDocuments.title,
          stepKey: schema.supplierDocuments.stepKey,
          editionId: schema.supplierDocuments.editionId,
        })
        .from(schema.supplierDocuments)
        .where(eq(schema.supplierDocuments.id, documentId))
        .limit(1);
      if (!current) throw new Error("That document no longer exists.");

      const [{ acks } = { acks: 0 }] = await tx
        .select({ acks: sql<number>`count(*)::int` })
        .from(schema.supplierDocumentAcks)
        .where(eq(schema.supplierDocumentAcks.documentId, documentId));

      await tx
        .delete(schema.supplierDocuments)
        .where(eq(schema.supplierDocuments.id, documentId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier_document.delete",
        subject: documentId,
        meta: {
          title: current.title,
          stepKey: current.stepKey,
          acknowledgementsDiscarded: Number(acks),
        },
      });

      reopened = (
        await reconcileEditionSupplierSteps(
          tx,
          current.editionId,
          current.stepKey ? [current.stepKey as SupplierOnboardingStepKey] : [],
          session.dbUserId,
        )
      ).reopened;
    });

    await notifyReopened(reopened);
    revalidatePath("/suppliers");
    revalidatePath("/suppliers/signup-management");
  });
}

/** One document row plus how many suppliers have acknowledged it. */
export interface OrgSupplierDocumentRow {
  id: string;
  title: string;
  sourceType: "file" | "link";
  url: string;
  requiredAck: boolean;
  stepKey: string | null;
  sort: number;
  ackCount: number;
}

/**
 * The edition's documents with acknowledgement counts, for the console list.
 * Org-gated like every other console read.
 */
export async function listSupplierDocuments(
  editionId: string,
): Promise<OrgSupplierDocumentRow[]> {
  // A read: every rank sees the document list (it is org content, not a person).
  await requireOrgSession({ capability: "read" });
  const db = getDb();
  const rows = await db
    .select({
      id: schema.supplierDocuments.id,
      title: schema.supplierDocuments.title,
      sourceType: schema.supplierDocuments.sourceType,
      url: schema.supplierDocuments.url,
      requiredAck: schema.supplierDocuments.requiredAck,
      stepKey: schema.supplierDocuments.stepKey,
      sort: schema.supplierDocuments.sort,
      ackCount: sql<number>`(
        select count(*)::int from ${schema.supplierDocumentAcks}
        where ${schema.supplierDocumentAcks.documentId} = ${schema.supplierDocuments.id}
      )`,
    })
    .from(schema.supplierDocuments)
    .where(eq(schema.supplierDocuments.editionId, editionId))
    .orderBy(
      asc(schema.supplierDocuments.sort),
      asc(schema.supplierDocuments.title),
    );
  return rows.map((r) => ({ ...r, ackCount: Number(r.ackCount) }));
}

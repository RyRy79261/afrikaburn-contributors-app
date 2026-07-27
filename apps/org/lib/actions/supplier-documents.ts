"use server";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { SupplierDocumentInput } from "@quagga/types";
import { validateDocumentBinding } from "@quagga/core";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
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

    // Sort computation, insert and audit are one atomic unit.
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
    });

    revalidatePath("/suppliers");
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
 * legitimately RE-OPENS that step for suppliers who had it complete. That
 * reconciliation happens on the supplier's next ack (or page load) through
 * `applyDocumentAcksToSteps`, which recomputes from the current document list —
 * there is no stale "completed" to clean up here.
 */
export async function updateSupplierDocument(
  raw: z.input<typeof UpdateDocumentInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "write" });
    const { documentId, ...input } = UpdateDocumentInput.parse(raw);

    const binding = validateDocumentBinding(input.stepKey, input.requiredAck);
    if (!binding.ok) throw new Error(binding.reason);

    // Read, update and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          id: schema.supplierDocuments.id,
          sort: schema.supplierDocuments.sort,
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
    });

    revalidatePath("/suppliers");
  });
}

const DeleteDocumentInput = z.object({ documentId: z.string().uuid() });

/**
 * Withdraw a document. Its acknowledgements cascade away with it — which is
 * correct: an acknowledgement of a document that no longer exists is not
 * evidence of anything. The ack count is captured for the audit trail first,
 * because that is the only place it survives.
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

    // Read, ack-count, delete and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          title: schema.supplierDocuments.title,
          stepKey: schema.supplierDocuments.stepKey,
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
    });

    revalidatePath("/suppliers");
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

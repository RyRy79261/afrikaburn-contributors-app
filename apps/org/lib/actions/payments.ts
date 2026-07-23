"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { PaymentStatus } from "@quagga/types";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

const SetPaymentStatusInput = z.object({
  paymentId: z.string().uuid(),
  status: PaymentStatus,
});

const AUDIT_ACTION: Record<z.infer<typeof PaymentStatus>, string> = {
  reconciled: "payment.reconcile",
  waived: "payment.waive",
  pending: "payment.reopen",
};

/**
 * Mark a payment reference reconciled or waived (or reopen to pending). The
 * platform never moves money — this only tracks AfrikaBurn's off-platform
 * reconciliation. Records the acting staff member and audits.
 */
export async function setPaymentStatus(
  raw: z.input<typeof SetPaymentStatusInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = SetPaymentStatusInput.parse(raw);

    const db = getDb();
    const [payment] = await db
      .select({ reference: schema.payments.reference })
      .from(schema.payments)
      .where(eq(schema.payments.id, input.paymentId))
      .limit(1);
    if (!payment) throw new Error("That payment reference no longer exists.");

    await db
      .update(schema.payments)
      .set({
        status: input.status,
        recordedByUserId: session.dbUserId,
        updatedAt: new Date(),
      })
      .where(eq(schema.payments.id, input.paymentId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: AUDIT_ACTION[input.status],
      subject: input.paymentId,
      meta: { reference: payment.reference, status: input.status },
    });

    revalidatePath("/payments");
    revalidatePath("/");
  });
}

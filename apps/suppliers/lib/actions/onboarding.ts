"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  applyStepTransition,
  supplierOnboardingStep,
  isOrgConfirmedStep,
} from "@quagga/core";
import { SupplierOnboardingStepKey, SupplierOnboardingStepStatus } from "@quagga/types";

import { getDb, schema } from "@/lib/db";
import { requireSupplierSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

const SetStepInput = z.object({
  stepKey: SupplierOnboardingStepKey,
  to: SupplierOnboardingStepStatus,
});

/**
 * Drive one onboarding step as the supplier. All authority lives in
 * `@quagga/core`'s `applyStepTransition` (actor `supplier`): self-service steps
 * flip pending↔completed, org-reviewed steps flip pending↔awaiting_confirmation,
 * and org-confirmed steps (deposit / briefing / fee) are rejected outright —
 * a supplier can never confirm those. The action re-reads current state from
 * the DB and re-validates; the client value is never trusted.
 */
export async function setOnboardingStep(
  raw: z.input<typeof SetStepInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSupplierSession();
    const input = SetStepInput.parse(raw);

    const step = supplierOnboardingStep(input.stepKey);
    if (!step) throw new Error("Unknown onboarding step.");
    if (isOrgConfirmedStep(step)) {
      throw new Error("Only AfrikaBurn can confirm this step.");
    }

    const result = applyStepTransition(
      session.steps,
      "supplier",
      input.stepKey,
      input.to,
    );
    if (!result.ok) throw new Error(result.reason);

    const db = getDb();
    await db
      .update(schema.supplierOnboarding)
      .set({ steps: result.steps, updatedAt: new Date() })
      .where(
        and(
          eq(schema.supplierOnboarding.supplierId, session.supplier.id),
          eq(schema.supplierOnboarding.editionId, session.edition.id),
        ),
      );

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.onboarding_step",
      subject: session.supplier.id,
      meta: { step: input.stepKey, to: input.to, edition: session.edition.year },
    });

    revalidatePath("/onboarding");
  });
}

"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  applyStepTransition,
  supplierOnboardingStep,
  isOrgConfirmedStep,
} from "@quagga/core";
import {
  SupplierOnboardingStepKey,
  SupplierOnboardingStepStatus,
} from "@quagga/types";

import { schema, withTransaction } from "@/lib/db";
import { requireSupplierSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { requiredDocumentsBoundToStep } from "@/lib/documents";
import { lockOnboardingSteps } from "@/lib/onboarding-store";
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
 *
 * A step with a required document bound to it is refused here entirely: such a
 * step has exactly ONE completion path, the acknowledgement — see the guard
 * below.
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

    // The guard, the state read, the transition and its audit event land
    // together, so the trail can never disagree with the stored step map — and
    // so the binding cannot change between being checked and being relied on.
    await withTransaction(async (tx) => {
      // ONE STEP, ONE WAY TO COMPLETE IT.
      //
      // When the org binds a required document to a step, acknowledging that
      // document is what completes it (`applyDocumentAcksToSteps`). This action
      // was a second, independent route to the same `completed` — and it skipped
      // the document entirely. Two things went wrong for a real supplier:
      // they could press "Sign the agreement" without ever opening the
      // agreement; and because reconciliation recomputes every bound step from
      // the acknowledgements, their very next tick on ANY document quietly
      // reverted the step they had just signed. From the supplier's side the
      // signature simply came undone with no explanation.
      //
      // So: if a required document is bound, refuse and say where to go. The
      // acknowledgement remains the only writer of that step, in both
      // directions, which is also what makes reconciliation safe.
      const bound = await requiredDocumentsBoundToStep(
        session.edition.id,
        input.stepKey,
        tx,
      );
      const boundTitle = bound[0]?.title;
      if (boundTitle) {
        throw new Error(
          bound.length === 1
            ? `"${step.title}" is completed by acknowledging "${boundTitle}" — read it under Documents & links and tick its box.`
            : `"${step.title}" is completed by acknowledging its documents — read them under Documents & links and tick each box.`,
        );
      }

      // Validate against the map as it stands in THIS transaction, not the copy
      // resolved with the session (see `lockOnboardingSteps`).
      const stored = await lockOnboardingSteps(
        tx,
        session.supplier.id,
        session.edition.id,
      );
      const result = applyStepTransition(
        stored,
        "supplier",
        input.stepKey,
        input.to,
      );
      if (!result.ok) throw new Error(result.reason);

      await tx
        .update(schema.supplierOnboarding)
        .set({ steps: result.steps, updatedAt: new Date() })
        .where(
          and(
            eq(schema.supplierOnboarding.supplierId, session.supplier.id),
            eq(schema.supplierOnboarding.editionId, session.edition.id),
          ),
        );

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.onboarding_step",
        subject: session.supplier.id,
        meta: {
          step: input.stepKey,
          to: input.to,
          edition: session.edition.year,
        },
      });
    });

    revalidatePath("/onboarding");
  });
}

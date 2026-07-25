"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  SupplierNoteKind,
  SupplierOnboardingStepKey,
  SupplierOnboardingStepStatus,
  SupplierStanding,
} from "@quagga/types";
import {
  applyStepTransition,
  isSelfServiceStep,
  standingLabel,
  supplierOnboardingStep,
  supplierStandingNotification,
  supplierStepConfirmedNotification,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { getSupplierNotes, type SupplierNoteRow } from "@/lib/queries";
import { runAction, type ActionResult } from "./result";

const SetStandingInput = z.object({
  supplierId: z.string().uuid(),
  standing: SupplierStanding,
});

/** Set a supplier's standing (good/watch/suspended). Any org role. Audited. */
export async function setSupplierStanding(
  raw: z.input<typeof SetStandingInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = SetStandingInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name, userId: schema.suppliers.userId })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    await db
      .update(schema.suppliers)
      .set({ standing: input.standing, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, input.supplierId));

    // Event hook: a supplier only ever sees their OWN standing value change
    // (never notes). Thin + best-effort; only when an account is linked.
    if (supplier.userId) {
      try {
        await insertNotifications(db, [
          {
            ...supplierStandingNotification({
              standingLabel: standingLabel(input.standing),
            }),
            userId: supplier.userId,
          },
        ]);
      } catch (err) {
        console.error("[notifications] supplier standing hook failed", err);
      }
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.standing",
      subject: input.supplierId,
      meta: {
        name: supplier.name,
        standing: input.standing,
        label: standingLabel(input.standing),
      },
    });

    revalidatePath("/suppliers");
  });
}

const SetStepInput = z.object({
  supplierId: z.string().uuid(),
  editionId: z.string().uuid(),
  stepKey: SupplierOnboardingStepKey,
  status: SupplierOnboardingStepStatus,
});

/**
 * Org-side onboarding step move: confirm/revoke the org-confirmed steps
 * (deposit / briefing / fee) and review-mark the org-reviewed steps
 * (inventory / crew). Runs the @quagga/core transition rules with the org
 * actor, upserts the per-edition onboarding row, and audits. Any org role.
 */
export async function setSupplierOnboardingStep(
  raw: z.input<typeof SetStepInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = SetStepInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name, userId: schema.suppliers.userId })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    const [existing] = await db
      .select({ steps: schema.supplierOnboarding.steps })
      .from(schema.supplierOnboarding)
      .where(
        and(
          eq(schema.supplierOnboarding.supplierId, input.supplierId),
          eq(schema.supplierOnboarding.editionId, input.editionId),
        ),
      )
      .limit(1);

    const applied = applyStepTransition(
      existing?.steps ?? null,
      "org",
      input.stepKey,
      input.status,
    );
    if (!applied.ok) throw new Error(applied.reason);

    await db
      .insert(schema.supplierOnboarding)
      .values({
        supplierId: input.supplierId,
        editionId: input.editionId,
        steps: applied.steps,
      })
      .onConflictDoUpdate({
        target: [
          schema.supplierOnboarding.supplierId,
          schema.supplierOnboarding.editionId,
        ],
        set: { steps: applied.steps, updatedAt: new Date() },
      });

    // Event hook: notify the supplier when the ORG confirms a step to completed
    // (deposit / briefing / fee, and org-reviewed inventory / crew — never a
    // self-service step the supplier drove themselves). Thin + best-effort.
    if (supplier.userId && input.status === "completed") {
      const step = supplierOnboardingStep(input.stepKey);
      if (step && !isSelfServiceStep(step)) {
        try {
          await insertNotifications(db, [
            {
              ...supplierStepConfirmedNotification({ stepLabel: step.title }),
              userId: supplier.userId,
            },
          ]);
        } catch (err) {
          console.error("[notifications] supplier step hook failed", err);
        }
      }
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.onboarding",
      subject: input.supplierId,
      meta: {
        name: supplier.name,
        editionId: input.editionId,
        step: input.stepKey,
        status: input.status,
      },
    });

    revalidatePath("/suppliers");
  });
}

const AddNoteInput = z.object({
  supplierId: z.string().uuid(),
  kind: SupplierNoteKind,
  body: z.string().trim().min(1, "A note body is required.").max(2000),
});

/** Add an org-internal note (infraction/blessing/note). Any org role. Audited. */
export async function addSupplierNote(
  raw: z.input<typeof AddNoteInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = AddNoteInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    const [created] = await db
      .insert(schema.supplierNotes)
      .values({
        supplierId: input.supplierId,
        authorId: session.dbUserId,
        kind: input.kind,
        body: input.body,
      })
      .returning({ id: schema.supplierNotes.id });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.note",
      subject: input.supplierId,
      meta: { name: supplier.name, kind: input.kind, noteId: created?.id },
    });

    revalidatePath("/suppliers");
  });
}

const FetchNotesInput = z.object({ supplierId: z.string().uuid() });

export type FetchNotesResult =
  | { ok: true; notes: SupplierNoteRow[] }
  | { ok: false; error: string };

/**
 * Load a supplier's notes timeline for the drawer. Data-returning action, so
 * it re-checks authz (org role) itself rather than relying on the page gate.
 */
export async function fetchSupplierNotes(
  raw: z.input<typeof FetchNotesInput>,
): Promise<FetchNotesResult> {
  try {
    await requireOrgSession();
    const input = FetchNotesInput.parse(raw);
    const notes = await getSupplierNotes(input.supplierId);
    return { ok: true, notes };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Could not load notes.";
    return { ok: false, error };
  }
}

const AddSupplierInput = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  website: z.string().trim().max(300).optional(),
});

/** Hand-add a supplier. Standing defaults to `good`. Any org role. Audited. */
export async function addSupplier(
  raw: z.input<typeof AddSupplierInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = AddSupplierInput.parse(raw);

    const db = getDb();
    const [created] = await db
      .insert(schema.suppliers)
      .values({
        name: input.name,
        services: input.services || null,
        contact: input.contact || null,
        website: input.website || null,
      })
      .returning({ id: schema.suppliers.id });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.add",
      subject: created?.id,
      meta: { name: input.name },
    });

    revalidatePath("/suppliers");
  });
}

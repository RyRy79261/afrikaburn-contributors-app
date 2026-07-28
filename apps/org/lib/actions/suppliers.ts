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

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { getSupplierNotes, type SupplierNoteRow } from "@/lib/queries";
import { runAction, type ActionResult } from "./result";

const SetStandingInput = z.object({
  supplierId: z.string().uuid(),
  standing: SupplierStanding,
});

/** Set a supplier's standing (good/watch/suspended). Needs `write`. Audited. */
export async function setSupplierStanding(
  raw: z.input<typeof SetStandingInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "suppliers",
    });
    const input = SetStandingInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name, userId: schema.suppliers.userId })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    // The standing change and its audit row are one atomic unit.
    await withTransaction(async (tx) => {
      await tx
        .update(schema.suppliers)
        .set({ standing: input.standing, updatedAt: new Date() })
        .where(eq(schema.suppliers.id, input.supplierId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.standing",
        subject: input.supplierId,
        meta: {
          name: supplier.name,
          standing: input.standing,
          label: standingLabel(input.standing),
        },
      });
    });

    // Event hook: a supplier only ever sees their OWN standing value change
    // (never notes). Thin + best-effort, AFTER commit; only when an account is
    // linked. A notification failure never rolls the standing change back.
    if (supplier.userId) {
      try {
        await insertNotifications(db, [
          {
            ...supplierStandingNotification({
              standingLabel: standingLabel(input.standing),
            }),
            userId: supplier.userId,
            // Sent BY the org, read IN the suppliers app: /onboarding is a
            // suppliers route, not a console one.
            origin: "org" as const,
            linkApp: "suppliers" as const,
          },
        ]);
      } catch (err) {
        console.error("[notifications] supplier standing hook failed", err);
      }
    }

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
 * actor, upserts the per-edition onboarding row, and audits. Needs `write`.
 */
export async function setSupplierOnboardingStep(
  raw: z.input<typeof SetStepInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "suppliers",
    });
    const input = SetStepInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name, userId: schema.suppliers.userId })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    // The current-step read, the transition (validated in @quagga/core), the
    // upsert and the audit row are one atomic unit — the persisted step map and
    // its audit trail can never disagree.
    await withTransaction(async (tx) => {
      const [existing] = await tx
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

      await tx
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

      await writeAuditEvent(tx, {
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
    });

    // Event hook: notify the supplier when the ORG confirms a step to completed
    // (deposit / briefing / fee, and org-reviewed inventory / crew — never a
    // self-service step the supplier drove themselves). Thin + best-effort,
    // AFTER commit.
    if (supplier.userId && input.status === "completed") {
      const step = supplierOnboardingStep(input.stepKey);
      if (step && !isSelfServiceStep(step)) {
        try {
          await insertNotifications(db, [
            {
              ...supplierStepConfirmedNotification({ stepLabel: step.title }),
              userId: supplier.userId,
              origin: "org" as const,
              linkApp: "suppliers" as const,
            },
          ]);
        } catch (err) {
          console.error("[notifications] supplier step hook failed", err);
        }
      }
    }

    revalidatePath("/suppliers");
  });
}

const AddNoteInput = z.object({
  supplierId: z.string().uuid(),
  kind: SupplierNoteKind,
  body: z.string().trim().min(1, "A note body is required.").max(2000),
});

/** Add an org-internal note (infraction/blessing/note). Needs `write`. Audited. */
export async function addSupplierNote(
  raw: z.input<typeof AddNoteInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "create",
      domain: "suppliers",
    });
    const input = AddNoteInput.parse(raw);

    // Existence check, note insert and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [supplier] = await tx
        .select({ name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, input.supplierId))
        .limit(1);
      if (!supplier) throw new Error("That supplier no longer exists.");

      const [created] = await tx
        .insert(schema.supplierNotes)
        .values({
          supplierId: input.supplierId,
          authorId: session.dbUserId,
          kind: input.kind,
          body: input.body,
        })
        .returning({ id: schema.supplierNotes.id });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.note",
        subject: input.supplierId,
        meta: { name: supplier.name, kind: input.kind, noteId: created?.id },
      });
    });

    revalidatePath("/suppliers");
  });
}

const FetchNotesInput = z.object({ supplierId: z.string().uuid() });

export type FetchNotesResult =
  { ok: true; notes: SupplierNoteRow[] } | { ok: false; error: string };

/**
 * Load a supplier's notes timeline for the drawer. Data-returning action, so it
 * re-checks authz itself rather than relying on the page gate — and passes the
 * resolved actor down, so the note AUTHORS' emails are omitted for a rank that
 * may not read personal information. A client-supplied actor would be no gate
 * at all; this one comes from the session.
 */
export async function fetchSupplierNotes(
  raw: z.input<typeof FetchNotesInput>,
): Promise<FetchNotesResult> {
  try {
    const session = await requireOrgSession({
      capability: "read",
      domain: "suppliers",
    });
    const input = FetchNotesInput.parse(raw);
    const notes = await getSupplierNotes(input.supplierId, session.actor);
    return { ok: true, notes };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Could not load notes.";
    return { ok: false, error };
  }
}

const AddSupplierInput = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  website: z.string().trim().max(300).optional(),
});

/** Hand-add a supplier. Standing defaults to `good`. Needs `write`. Audited. */
export async function addSupplier(
  raw: z.input<typeof AddSupplierInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "create",
      domain: "suppliers",
    });
    const input = AddSupplierInput.parse(raw);

    // Supplier insert and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(schema.suppliers)
        .values({
          name: input.name,
          services: input.services || null,
          contact: input.contact || null,
          website: input.website || null,
        })
        .returning({ id: schema.suppliers.id });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.add",
        subject: created?.id,
        meta: { name: input.name },
      });
    });

    revalidatePath("/suppliers");
  });
}

const DeleteSupplierInput = z.object({ supplierId: z.string().uuid() });

/**
 * Remove a supplier from the catalogue — for duplicates and bad imports.
 *
 * WHAT IT REFUSES, AND WHY. Four tables cascade off `suppliers`
 * (packages/db/src/schema.ts): onboarding, documents, document acks and
 * `supplier_declarations`. That last one is a CAMP'S RECORD that it declared
 * this supplier on its registration, and a cascade would erase it silently from
 * a page nobody was looking at. So:
 *
 *   - declared by any registration → REFUSED, with the count, because the row
 *     is somebody else's history and deleting it is not this screen's call.
 *     Fix the duplicate by renaming it or leaving it; a declared supplier is by
 *     definition not a stray import.
 *   - claimed by a real supplier account → REFUSED. Deleting it would strand a
 *     person mid-onboarding and orphan their uploaded documents. Suspend the
 *     account instead (standing → suspended), which is what that control is for.
 *
 * Anything else is an unclaimed, undeclared catalogue entry: safe to delete, and
 * its onboarding row goes with it. Audited either way.
 *
 * Needs the `delete` capability, so an engineer is refused here with an honest
 * message rather than merely losing the button — this is the destructive kind of
 * action their rank exists without.
 */
export async function deleteSupplier(
  raw: z.input<typeof DeleteSupplierInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    // NAMES ITS DOMAIN. `delete` is department-scoped, so the guard resolves
    // `suppliers` to whichever department owns it and refuses a role scoped
    // anywhere else. Omitting this would resolve to "belongs to no department"
    // and refuse every departmental lead — fail-closed, but wrong.
    const session = await requireOrgSession({
      capability: "delete",
      domain: "suppliers",
    });
    const { supplierId } = DeleteSupplierInput.parse(raw);
    const db = getDb();

    const [supplier] = await db
      .select({
        id: schema.suppliers.id,
        name: schema.suppliers.name,
        userId: schema.suppliers.userId,
      })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    if (supplier.userId) {
      throw new Error(
        "A supplier has claimed this listing, so deleting it would strand them " +
          "mid-onboarding and orphan their documents. Set their standing to " +
          "suspended instead.",
      );
    }

    const declarations = await db
      .select({ registrationId: schema.supplierDeclarations.registrationId })
      .from(schema.supplierDeclarations)
      .where(eq(schema.supplierDeclarations.supplierId, supplierId));
    if (declarations.length > 0) {
      const n = declarations.length;
      throw new Error(
        `${n} camp registration${n === 1 ? "" : "s"} declared this supplier. ` +
          "Deleting it would erase that from their registration, so it stays. " +
          "If this is a duplicate, rename it rather than removing it.",
      );
    }

    // Delete and audit atomically. The audit row records the NAME, because after
    // this commit the id resolves to nothing and a bare id is unreadable later.
    await withTransaction(async (tx) => {
      await tx
        .delete(schema.suppliers)
        .where(eq(schema.suppliers.id, supplierId));
      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.delete",
        subject: supplierId,
        meta: { name: supplier.name },
      });
    });

    revalidatePath("/suppliers");
    revalidatePath("/suppliers/signup-management");
  });
}

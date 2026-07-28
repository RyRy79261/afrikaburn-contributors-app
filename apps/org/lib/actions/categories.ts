"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { CampCategoryInput } from "@quagga/types";
import { validateCampCategory } from "@quagga/core";

import { schema, withTransaction, type DbHandle } from "@/lib/db";
import { requireSystemManager } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Org CRUD for the per-edition camp-category taxonomy (build-spec §"Camp
// categories"). Every write validates through @quagga/core (shape + per-edition
// dedupe) and is audited.
//
// SYSTEM MANAGER ONLY, deliberately (Ryan, 27 Jul 2026: "The categories for
// example, These should only have CRUD operations by a system manager"). This
// is a TIGHTENING — org staff could previously manage the taxonomy. The reason
// it is one rank rather than two: the catalog is edition-wide reference data
// every camp's registration renders against, so a rename or a delete reaches
// every camp at once, and there is no per-camp blast radius to hide behind.
//
// ASSIGNMENT (`setGroupCategory`) is gated the same way rather than left as
// ordinary org work. It is the same screen and the same taxonomy, and half a
// permission is worse than either whole: a console that lets org staff strip a
// camp's categories but not rename them is a rule nobody can state.

/** Load the edition's existing categories (for dedupe), excluding `exceptId`. */
async function existingCategories(
  db: DbHandle,
  editionId: string,
): Promise<{ id: string; label: string }[]> {
  return db
    .select({
      id: schema.campCategories.id,
      label: schema.campCategories.label,
    })
    .from(schema.campCategories)
    .where(eq(schema.campCategories.editionId, editionId));
}

const CreateCategoryInput = CampCategoryInput.extend({
  editionId: z.string().uuid(),
});

/** Create a camp category for an edition. System manager only. Audited. */
export async function createCategory(
  raw: z.input<typeof CreateCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager("change the camp categories");
    const { editionId, ...rest } = CreateCategoryInput.parse(raw);

    // Dedupe read, sort computation, insert and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const existing = await existingCategories(tx, editionId);
      const valid = validateCampCategory(rest, existing);
      if (!valid.ok) throw new Error(valid.error);

      // Default sort to the end of the edition's list when not supplied.
      let sort = valid.sort;
      if (sort == null) {
        const [{ max } = { max: null }] = await tx
          .select({
            max: sql<number | null>`max(${schema.campCategories.sort})`,
          })
          .from(schema.campCategories)
          .where(eq(schema.campCategories.editionId, editionId));
        sort = max == null ? 0 : Number(max) + 1;
      }

      const [created] = await tx
        .insert(schema.campCategories)
        .values({
          editionId,
          label: valid.label,
          labelNormalized: valid.labelNormalized,
          emoji: valid.emoji,
          sort,
        })
        .returning({ id: schema.campCategories.id });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "category.create",
        subject: created?.id,
        meta: { editionId, label: valid.label, emoji: valid.emoji },
      });
    });

    revalidatePath("/categories");
  });
}

const UpdateCategoryInput = CampCategoryInput.extend({
  categoryId: z.string().uuid(),
});

/** Rename / re-emoji / re-sort a category. System manager only. Audited. */
export async function updateCategory(
  raw: z.input<typeof UpdateCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager("change the camp categories");
    const { categoryId, ...rest } = UpdateCategoryInput.parse(raw);

    // Read, dedupe-validate, update and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          id: schema.campCategories.id,
          editionId: schema.campCategories.editionId,
          sort: schema.campCategories.sort,
        })
        .from(schema.campCategories)
        .where(eq(schema.campCategories.id, categoryId))
        .limit(1);
      if (!current) throw new Error("That category no longer exists.");

      const existing = await existingCategories(tx, current.editionId);
      const valid = validateCampCategory(rest, existing, categoryId);
      if (!valid.ok) throw new Error(valid.error);

      await tx
        .update(schema.campCategories)
        .set({
          label: valid.label,
          labelNormalized: valid.labelNormalized,
          emoji: valid.emoji,
          sort: valid.sort ?? current.sort,
          updatedAt: new Date(),
        })
        .where(eq(schema.campCategories.id, categoryId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "category.update",
        subject: categoryId,
        meta: { label: valid.label, emoji: valid.emoji },
      });
    });

    revalidatePath("/categories");
  });
}

const DeleteCategoryInput = z.object({ categoryId: z.string().uuid() });

/** Delete a category (its group links cascade). System manager only. Audited. */
export async function deleteCategory(
  raw: z.input<typeof DeleteCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager("change the camp categories");
    const { categoryId } = DeleteCategoryInput.parse(raw);

    // Read, picker-count, delete and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [current] = await tx
        .select({ label: schema.campCategories.label })
        .from(schema.campCategories)
        .where(eq(schema.campCategories.id, categoryId))
        .limit(1);
      if (!current) throw new Error("That category no longer exists.");

      // Count pickers before deleting, for the audit trail.
      const [{ pickers } = { pickers: 0 }] = await tx
        .select({ pickers: sql<number>`count(*)::int` })
        .from(schema.groupCategories)
        .where(eq(schema.groupCategories.categoryId, categoryId));

      await tx
        .delete(schema.campCategories)
        .where(eq(schema.campCategories.id, categoryId));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "category.delete",
        subject: categoryId,
        meta: { label: current.label, pickers: Number(pickers) },
      });
    });

    revalidatePath("/categories");
  });
}

const AssignCategoryInput = z.object({
  groupId: z.string().uuid(),
  categoryId: z.string().uuid(),
  assigned: z.boolean(),
});

/**
 * Toggle a group ↔ category link (org-side management; camps also self-manage
 * their picks through the camp settings, but the console can curate).
 * Validates the category and group share the same edition scope by construction
 * (the picker only offers the edition's catalog). System manager only — see the
 * file header for why assignment is not held back as ordinary org work. Audited.
 */
// NO UI CALLS THIS YET. It is a reachable POST endpoint the moment it is
// exported, so it is deliberately gated the same as the rest of the taxonomy
// (system manager only), Zod-validated and audited — a god can already do
// everything, so the marginal exposure is nil. Kept rather than deleted because
// the curation screen it exists for is wanted; if that screen is abandoned,
// delete this with it rather than leaving an endpoint nobody remembers.
export async function setGroupCategory(
  raw: z.input<typeof AssignCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireSystemManager("change the camp categories");
    const input = AssignCategoryInput.parse(raw);

    // Existence check, link write and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [category] = await tx
        .select({ id: schema.campCategories.id })
        .from(schema.campCategories)
        .where(eq(schema.campCategories.id, input.categoryId))
        .limit(1);
      if (!category) throw new Error("That category no longer exists.");

      if (input.assigned) {
        await tx
          .insert(schema.groupCategories)
          .values({ groupId: input.groupId, categoryId: input.categoryId })
          .onConflictDoNothing({
            target: [
              schema.groupCategories.groupId,
              schema.groupCategories.categoryId,
            ],
          });
      } else {
        await tx
          .delete(schema.groupCategories)
          .where(
            and(
              eq(schema.groupCategories.groupId, input.groupId),
              eq(schema.groupCategories.categoryId, input.categoryId),
            ),
          );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "category.assign",
        subject: input.categoryId,
        meta: { groupId: input.groupId, assigned: input.assigned },
      });
    });

    revalidatePath("/categories");
  });
}

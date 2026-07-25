"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { CampCategoryInput } from "@quagga/types";
import { validateCampCategory } from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Org CRUD for the per-edition camp-category taxonomy (build-spec §"Camp
// categories"). Org-only, server-side authz via requireOrgSession; every write
// validates through @quagga/core (shape + per-edition dedupe) and is audited.

/** Load the edition's existing categories (for dedupe), excluding `exceptId`. */
async function existingCategories(
  db: ReturnType<typeof getDb>,
  editionId: string,
): Promise<{ id: string; label: string }[]> {
  return db
    .select({ id: schema.campCategories.id, label: schema.campCategories.label })
    .from(schema.campCategories)
    .where(eq(schema.campCategories.editionId, editionId));
}

const CreateCategoryInput = CampCategoryInput.extend({
  editionId: z.string().uuid(),
});

/** Create a camp category for an edition. Org-only. Audited. */
export async function createCategory(
  raw: z.input<typeof CreateCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const { editionId, ...rest } = CreateCategoryInput.parse(raw);

    const db = getDb();
    const existing = await existingCategories(db, editionId);
    const valid = validateCampCategory(rest, existing);
    if (!valid.ok) throw new Error(valid.error);

    // Default sort to the end of the edition's list when not supplied.
    let sort = valid.sort;
    if (sort == null) {
      const [{ max } = { max: null }] = await db
        .select({ max: sql<number | null>`max(${schema.campCategories.sort})` })
        .from(schema.campCategories)
        .where(eq(schema.campCategories.editionId, editionId));
      sort = max == null ? 0 : Number(max) + 1;
    }

    const [created] = await db
      .insert(schema.campCategories)
      .values({
        editionId,
        label: valid.label,
        labelNormalized: valid.labelNormalized,
        emoji: valid.emoji,
        sort,
      })
      .returning({ id: schema.campCategories.id });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "category.create",
      subject: created?.id,
      meta: { editionId, label: valid.label, emoji: valid.emoji },
    });

    revalidatePath("/categories");
  });
}

const UpdateCategoryInput = CampCategoryInput.extend({
  categoryId: z.string().uuid(),
});

/** Rename / re-emoji / re-sort a category. Org-only. Audited. */
export async function updateCategory(
  raw: z.input<typeof UpdateCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const { categoryId, ...rest } = UpdateCategoryInput.parse(raw);

    const db = getDb();
    const [current] = await db
      .select({
        id: schema.campCategories.id,
        editionId: schema.campCategories.editionId,
        sort: schema.campCategories.sort,
      })
      .from(schema.campCategories)
      .where(eq(schema.campCategories.id, categoryId))
      .limit(1);
    if (!current) throw new Error("That category no longer exists.");

    const existing = await existingCategories(db, current.editionId);
    const valid = validateCampCategory(rest, existing, categoryId);
    if (!valid.ok) throw new Error(valid.error);

    await db
      .update(schema.campCategories)
      .set({
        label: valid.label,
        labelNormalized: valid.labelNormalized,
        emoji: valid.emoji,
        sort: valid.sort ?? current.sort,
        updatedAt: new Date(),
      })
      .where(eq(schema.campCategories.id, categoryId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "category.update",
      subject: categoryId,
      meta: { label: valid.label, emoji: valid.emoji },
    });

    revalidatePath("/categories");
  });
}

const DeleteCategoryInput = z.object({ categoryId: z.string().uuid() });

/** Delete a category (its group links cascade). Org-only. Audited. */
export async function deleteCategory(
  raw: z.input<typeof DeleteCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const { categoryId } = DeleteCategoryInput.parse(raw);

    const db = getDb();
    const [current] = await db
      .select({ label: schema.campCategories.label })
      .from(schema.campCategories)
      .where(eq(schema.campCategories.id, categoryId))
      .limit(1);
    if (!current) throw new Error("That category no longer exists.");

    // Count pickers before deleting, for the audit trail.
    const [{ pickers } = { pickers: 0 }] = await db
      .select({ pickers: sql<number>`count(*)::int` })
      .from(schema.groupCategories)
      .where(eq(schema.groupCategories.categoryId, categoryId));

    await db
      .delete(schema.campCategories)
      .where(eq(schema.campCategories.id, categoryId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "category.delete",
      subject: categoryId,
      meta: { label: current.label, pickers: Number(pickers) },
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
 * their picks through the camp settings, but the console can curate). Org-only.
 * Validates the category and group share the same edition scope by construction
 * (the picker only offers the edition's catalog). Audited.
 */
export async function setGroupCategory(
  raw: z.input<typeof AssignCategoryInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = AssignCategoryInput.parse(raw);

    const db = getDb();
    const [category] = await db
      .select({ id: schema.campCategories.id })
      .from(schema.campCategories)
      .where(eq(schema.campCategories.id, input.categoryId))
      .limit(1);
    if (!category) throw new Error("That category no longer exists.");

    if (input.assigned) {
      await db
        .insert(schema.groupCategories)
        .values({ groupId: input.groupId, categoryId: input.categoryId })
        .onConflictDoNothing({
          target: [
            schema.groupCategories.groupId,
            schema.groupCategories.categoryId,
          ],
        });
    } else {
      await db
        .delete(schema.groupCategories)
        .where(
          and(
            eq(schema.groupCategories.groupId, input.groupId),
            eq(schema.groupCategories.categoryId, input.categoryId),
          ),
        );
    }

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "category.assign",
      subject: input.categoryId,
      meta: { groupId: input.groupId, assigned: input.assigned },
    });

    revalidatePath("/categories");
  });
}

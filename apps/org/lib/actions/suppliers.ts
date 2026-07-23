"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { VettingStatus } from "@quagga/types";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

const SetVettingInput = z.object({
  supplierId: z.string().uuid(),
  vettingStatus: VettingStatus,
});

/** Change a supplier's vetting status. Any org role. Audited. */
export async function setSupplierVetting(
  raw: z.input<typeof SetVettingInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession();
    const input = SetVettingInput.parse(raw);

    const db = getDb();
    const [supplier] = await db
      .select({ name: schema.suppliers.name })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, input.supplierId))
      .limit(1);
    if (!supplier) throw new Error("That supplier no longer exists.");

    await db
      .update(schema.suppliers)
      .set({ vettingStatus: input.vettingStatus, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, input.supplierId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.vetting",
      subject: input.supplierId,
      meta: { name: supplier.name, vettingStatus: input.vettingStatus },
    });

    revalidatePath("/suppliers");
  });
}

const AddSupplierInput = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  website: z.string().trim().max(300).optional(),
});

/** Hand-add a supplier (source `manual`). Any org role. Audited. */
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
        vettingStatus: "listed",
        source: "manual",
      })
      .returning({ id: schema.suppliers.id });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.add",
      subject: created?.id,
      meta: { name: input.name, source: "manual" },
    });

    revalidatePath("/suppliers");
  });
}

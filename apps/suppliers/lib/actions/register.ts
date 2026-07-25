"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { assignSupplierCode } from "@/lib/supplier-code";
import { runAction, type ActionResult } from "./result";

// A signed-in user with no matching supplier row registers themselves as a
// supplier. This creates the `suppliers` row linked to their account and seeds
// the onboarding row for the active edition with step 1 (registration_form)
// already `completed` — filling this form IS the registration step.
const RegisterSupplierInput = z.object({
  name: z.string().trim().min(1, "A business name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  website: z.string().trim().max(300).optional(),
});

export async function registerSupplier(
  raw: z.input<typeof RegisterSupplierInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error("Sign in first.");
    const input = RegisterSupplierInput.parse(raw);

    const db = getDb();

    // Ensure the users join row, then read its id.
    await db
      .insert(schema.users)
      .values({ authUserId: user.id, email: user.primaryEmail })
      .onConflictDoUpdate({
        target: schema.users.authUserId,
        set: { email: user.primaryEmail },
      });
    const [dbUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.authUserId, user.id))
      .limit(1);
    if (!dbUser) throw new Error("Your account isn't ready yet. Try again.");

    // Guard against a double-register: if a row is already linked, stop.
    const [existing] = await db
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.userId, dbUser.id))
      .limit(1);
    if (existing) throw new Error("You're already registered as a supplier.");

    // The active (or most recent) edition to scope onboarding to.
    const [edition] =
      (await db
        .select({ id: schema.editions.id, year: schema.editions.year })
        .from(schema.editions)
        .where(eq(schema.editions.isActive, true))
        .limit(1)) ??
      [];
    const editionRow =
      edition ??
      (
        await db
          .select({ id: schema.editions.id, year: schema.editions.year })
          .from(schema.editions)
          .orderBy(desc(schema.editions.year))
          .limit(1)
      )[0];
    if (!editionRow) throw new Error("No active AfrikaBurn edition is set up yet.");

    const [created] = await db
      .insert(schema.suppliers)
      .values({
        name: input.name,
        services: input.services || null,
        contact: input.contact || null,
        website: input.website || null,
        standing: "good",
        userId: dbUser.id,
      })
      .returning({ id: schema.suppliers.id });
    if (!created) throw new Error("Could not create your supplier profile.");

    // Issue the supplier's reference code (`SUP-2027-0416`) — the number the
    // depot and camps quote. Non-fatal if it can't be allocated: a missing code
    // never blocks onboarding and can be backfilled.
    const code = await assignSupplierCode(db, created.id, editionRow.year);

    // Seed onboarding with the registration form already done.
    await db
      .insert(schema.supplierOnboarding)
      .values({
        supplierId: created.id,
        editionId: editionRow.id,
        steps: { registration_form: "completed" },
      })
      .onConflictDoUpdate({
        target: [
          schema.supplierOnboarding.supplierId,
          schema.supplierOnboarding.editionId,
        ],
        set: { updatedAt: new Date() },
      });

    await writeAuditEvent(db, {
      actorId: dbUser.id,
      action: "supplier.register",
      subject: created.id,
      meta: { name: input.name, code, via: "portal_self_register" },
    });

    revalidatePath("/onboarding");
    revalidatePath("/standing");
    revalidatePath("/");
  });
}

/** Update the supplier's own registration details. Re-affirms step 1 done. */
const UpdateProfileInput = z.object({
  name: z.string().trim().min(1, "A business name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  website: z.string().trim().max(300).optional(),
});

export async function updateSupplierProfile(
  raw: z.input<typeof UpdateProfileInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    // Imported here (not top-level) to keep the register path free of the
    // portal-session dependency during a first-time register.
    const { requireSupplierSession } = await import("@/lib/session");
    const session = await requireSupplierSession();
    const input = UpdateProfileInput.parse(raw);

    const db = getDb();
    await db
      .update(schema.suppliers)
      .set({
        name: input.name,
        services: input.services || null,
        contact: input.contact || null,
        website: input.website || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.suppliers.id, session.supplier.id));

    // Filling in registration details satisfies step 1.
    const nextSteps = { ...session.steps, registration_form: "completed" as const };
    await db
      .update(schema.supplierOnboarding)
      .set({ steps: nextSteps, updatedAt: new Date() })
      .where(
        and(
          eq(schema.supplierOnboarding.supplierId, session.supplier.id),
          eq(schema.supplierOnboarding.editionId, session.edition.id),
        ),
      );

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "supplier.profile_update",
      subject: session.supplier.id,
    });

    revalidatePath("/onboarding");
  });
}

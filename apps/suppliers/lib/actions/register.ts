"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { isSanitized } from "@quagga/core";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDb, schema, withTransaction } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { assignSupplierCode } from "@/lib/supplier-code";
import { runAction, type ActionResult } from "./result";

// A signed-in user with no matching supplier row registers themselves as a
// supplier. This creates the `suppliers` row linked to their account and seeds
// the onboarding row for the active edition with step 1 (registration_form)
// already `completed` — filling this form IS the registration step.
//
// `category` arrives from the /signup screen (canvas `K3zNk`). Optional, so the
// landing-page register form — which doesn't ask for it — keeps working
// unchanged. The vocabulary is the same one the sheet importer normalises to
// (@quagga/core `normalizeCategory`), so a self-registered supplier and an
// imported one land in the same bucket. There is no separate contact-person
// column: `contact` is the free-text "person · email" line the whole codebase
// already reads (it is what email-overlap linking matches against).
const RegisterSupplierInput = z.object({
  name: z.string().trim().min(1, "A business name is required.").max(200),
  services: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(300).optional(),
  category: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
});

export async function registerSupplier(
  raw: z.input<typeof RegisterSupplierInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const user = await getAuthenticatedUser();
    if (!user) throw new Error("Sign in first.");
    const input = RegisterSupplierInput.parse(raw);

    // The supplier row and its onboarding seed must land together (or not at
    // all) — a supplier with no onboarding row, or vice-versa, would be an
    // orphan. Wrapped in one pooled transaction. The reference-code allocation
    // is deliberately kept OUTSIDE the transaction: it retries on unique-code
    // collisions by catching the violation, which would poison a surrounding
    // Postgres transaction, and it is explicitly non-fatal + backfillable.
    const { supplierId, editionYear, actorId } = await withTransaction(
      async (tx) => {
        // Ensure the users join row, then read its id. onConflictDoNothing (not
        // Update): never clobber a sanitized (deleted) account's nulled email.
        await tx
          .insert(schema.users)
          .values({ authUserId: user.id, email: user.primaryEmail })
          .onConflictDoNothing({ target: schema.users.authUserId });
        const [dbUser] = await tx
          .select({ id: schema.users.id, sanitizedAt: schema.users.sanitizedAt })
          .from(schema.users)
          .where(eq(schema.users.authUserId, user.id))
          .limit(1);
        if (!dbUser) throw new Error("Your account isn't ready yet. Try again.");
        // A deleted-and-sanitized account cannot register as a supplier.
        if (isSanitized(dbUser)) throw new Error("Sign in first.");

        // Guard against a double-register: if a row is already linked, stop.
        const [existing] = await tx
          .select({ id: schema.suppliers.id })
          .from(schema.suppliers)
          .where(eq(schema.suppliers.userId, dbUser.id))
          .limit(1);
        if (existing) throw new Error("You're already registered as a supplier.");

        // The active (or most recent) edition to scope onboarding to.
        const [edition] =
          (await tx
            .select({ id: schema.editions.id, year: schema.editions.year })
            .from(schema.editions)
            .where(eq(schema.editions.isActive, true))
            .limit(1)) ??
          [];
        const editionRow =
          edition ??
          (
            await tx
              .select({ id: schema.editions.id, year: schema.editions.year })
              .from(schema.editions)
              .orderBy(desc(schema.editions.year))
              .limit(1)
          )[0];
        if (!editionRow)
          throw new Error("No active AfrikaBurn edition is set up yet.");

        const [created] = await tx
          .insert(schema.suppliers)
          .values({
            name: input.name,
            services: input.services || null,
            contact: input.contact || null,
            category: input.category || null,
            website: input.website || null,
            standing: "good",
            userId: dbUser.id,
          })
          .returning({ id: schema.suppliers.id });
        if (!created) throw new Error("Could not create your supplier profile.");

        // Seed onboarding with the registration form already done.
        await tx
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

        return {
          supplierId: created.id,
          editionYear: editionRow.year,
          actorId: dbUser.id,
        };
      },
    );

    // Issue the supplier's reference code (`SUP-2027-0416`) — the number the
    // depot and camps quote. Post-commit, on the HTTP db: non-fatal if it can't
    // be allocated (a missing code never blocks onboarding and is backfillable),
    // and its collision-retry loop is incompatible with a live transaction.
    const db = getDb();
    const code = await assignSupplierCode(db, supplierId, editionYear);

    await writeAuditEvent(db, {
      actorId,
      action: "supplier.register",
      subject: supplierId,
      meta: {
        name: input.name,
        category: input.category ?? null,
        code,
        via: "portal_self_register",
      },
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

    // Profile update + the step-1 re-affirm + audit are one atomic unit: a saved
    // profile whose step map wasn't updated (or vice-versa) would misrepresent
    // the supplier's onboarding state.
    await withTransaction(async (tx) => {
      await tx
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
      const nextSteps = {
        ...session.steps,
        registration_form: "completed" as const,
      };
      await tx
        .update(schema.supplierOnboarding)
        .set({ steps: nextSteps, updatedAt: new Date() })
        .where(
          and(
            eq(schema.supplierOnboarding.supplierId, session.supplier.id),
            eq(schema.supplierOnboarding.editionId, session.edition.id),
          ),
        );

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "supplier.profile_update",
        subject: session.supplier.id,
      });
    });

    revalidatePath("/onboarding");
  });
}

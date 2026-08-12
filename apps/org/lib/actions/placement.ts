"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { parsePlacementAssignment } from "@quagga/core";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Staff-assigned camp code + erf (roadmap R1: "Staff-assigned ERFs + camp codes
// on profiles — unblocks container booking without any placement tool").
//
// THE CAPABILITY IS `update` IN `registrations`, exactly like deciding a
// registration and assigning a wrangler. Writing a camp's erf onto its
// registration is the placement half of the same review the theme-camp leads
// team already owns; a separate domain would let a department review camps
// without being able to write down where any of them go.
//
// NOT NOTIFIED, deliberately. A camp code appears on the camp's own page the
// moment it is set, and an erf that will be revised three times before the map
// is final should not fire three "your placement has changed" pushes. The camp
// learns its erf when AfrikaBurn tells it, which is a placement announcement,
// not an inbox event.

const AssignInput = z.object({
  registrationId: z.string().uuid(),
  // Both accept "" as "clear this field" — the form posts empty strings.
  campCode: z.string().max(64).nullish(),
  erf: z.string().max(128).nullish(),
});

/**
 * Set (or clear) a registration's camp code and erf.
 *
 * Both fields move together because they are one decision made at one desk, and
 * a partial update API would let a second staff member's save silently blank the
 * field the first one just wrote.
 */
export async function assignPlacement(
  raw: z.input<typeof AssignInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = AssignInput.parse(raw);
    const db = getDb();

    // Normalization and shape-checking are the pure @quagga/core function, so
    // the rules live in one tested place rather than in this action's zod schema.
    const { campCode, erf } = parsePlacementAssignment({
      campCode: input.campCode,
      erf: input.erf,
    });

    const [registration] = await db
      .select({
        id: schema.registrations.id,
        editionId: schema.registrations.editionId,
        groupId: schema.registrations.groupId,
        campSlug: schema.groups.slug,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    // PRE-CHECKED FOR A READABLE MESSAGE, not for correctness — the partial
    // unique index on (edition_id, camp_code) is what actually guarantees
    // uniqueness under a race. Without this read the staff member would see a
    // raw constraint-violation string instead of the name of the camp already
    // holding the code.
    if (campCode !== null) {
      const [clash] = await db
        .select({ campName: schema.groups.name })
        .from(schema.registrations)
        .innerJoin(
          schema.groups,
          eq(schema.groups.id, schema.registrations.groupId),
        )
        .where(
          and(
            eq(schema.registrations.editionId, registration.editionId),
            eq(schema.registrations.campCode, campCode),
            ne(schema.registrations.id, registration.id),
          ),
        )
        .limit(1);
      if (clash) {
        throw new Error(
          `${clash.campName} already has the code ${campCode} this edition. Pick another.`,
        );
      }
    }

    await withTransaction(async (tx) => {
      await tx
        .update(schema.registrations)
        .set({ campCode, erf, updatedAt: new Date() })
        .where(eq(schema.registrations.id, registration.id));

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "registration.placement_assign",
        subject: registration.groupId,
        meta: {
          registrationId: registration.id,
          editionId: registration.editionId,
          campCode,
          erf,
        },
      });
    });

    revalidatePath(`/registrations/${registration.id}`);
    revalidatePath("/registrations");
  });
}

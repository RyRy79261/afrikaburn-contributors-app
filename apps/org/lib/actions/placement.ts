"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  parsePlacementAssignment,
  placementChange,
  placementNotification,
  type PlacementAssignment,
  type PlacementChange,
} from "@quagga/core";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { runActionWith, type ActionResultOf } from "./result";

// Staff-assigned camp code + erf (roadmap R1: "Staff-assigned ERFs + camp codes
// on profiles — unblocks container booking without any placement tool").
//
// THE CAPABILITY IS `update` IN `registrations`, exactly like deciding a
// registration and assigning a wrangler. Writing a camp's erf onto its
// registration is the placement half of the same review the theme-camp leads
// team already owns; a separate domain would let a department review camps
// without being able to write down where any of them go.
//
// NOTIFIED ON FIRST ASSIGNMENT AND ON EVERY CHANGE (Ryan, 27 Sep 2026, epic
// #48). This file used to refuse to notify at all, on the grounds that an erf
// revised three times would send three pushes. The decision was that the camp
// hearing about each revision is worth it. What still does NOT notify, and why,
// is `placementChange` in @quagga/core: re-saving the same values, and a save
// whose only effect is clearing a field.

const AssignInput = z.object({
  registrationId: z.string().uuid(),
  // Both accept "" as "clear this field" — the form posts empty strings.
  campCode: z.string().max(64).nullish(),
  erf: z.string().max(128).nullish(),
});

/**
 * Tell a camp's leads/admins that AfrikaBurn set or changed its placement.
 *
 * Recipients are the camp's structural `lead`/`admin` memberships — the same
 * audience as a registration decision and a wrangler assignment. In-app only:
 * immediate email is reserved for registration decisions and blocking
 * questionnaires (docs/notifications-spec.md §Email), so this deliberately
 * does NOT consult `shouldSendImmediateEmail("registration")`, which would say
 * yes for the kind and email every revision. The daily digest picks it up.
 *
 * Best-effort, after commit — the wrangler and registration-decision pattern: a
 * notification failure must never roll back a placement that is already true.
 */
async function notifyPlacementChanged(
  db: ReturnType<typeof getDb>,
  input: {
    groupId: string;
    campName: string;
    campSlug: string;
    change: PlacementChange;
  },
): Promise<void> {
  try {
    const leads = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, input.groupId),
          inArray(schema.memberships.role, ["lead", "admin"]),
        ),
      );
    const userIds = [...new Set(leads.map((l) => l.userId))];
    if (userIds.length === 0) return;

    const payload = placementNotification({
      change: input.change,
      campName: input.campName,
      campSlug: input.campSlug,
    });
    await insertNotifications(
      db,
      userIds.map((userId) => ({
        ...payload,
        userId,
        origin: "org" as const,
        // Written by the org, read in the participant app (the camp page).
        linkApp: "web" as const,
      })),
    );
  } catch (err) {
    console.error("[notifications] placement hook failed", err);
  }
}

/**
 * Set (or clear) a registration's camp code and erf.
 *
 * Both fields move together because they are one decision made at one desk, and
 * a partial update API would let a second staff member's save silently blank the
 * field the first one just wrote.
 */
export async function assignPlacement(
  raw: z.input<typeof AssignInput>,
): Promise<ActionResultOf<PlacementAssignment>> {
  return runActionWith(async () => {
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
        campName: schema.groups.name,
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

    const change = await withTransaction(async (tx) => {
      // THE BEFORE-VALUES ARE READ UNDER THE ROW LOCK, inside the same
      // transaction as the write. Read outside it, two staff saving at once
      // could both compare against the same stale value — one notifying about
      // a change the other had already made, or neither noticing the change.
      const [current] = await tx
        .select({
          campCode: schema.registrations.campCode,
          erf: schema.registrations.erf,
        })
        .from(schema.registrations)
        .where(eq(schema.registrations.id, registration.id))
        .for("update");
      if (!current) throw new Error("That registration no longer exists.");

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

      return placementChange(current, { campCode, erf });
    });

    // Strictly after commit: a write that threw above (clash, unique-index
    // race, audit failure) rolled back and never reaches this line.
    if (change) {
      await notifyPlacementChanged(db, {
        groupId: registration.groupId,
        campName: registration.campName,
        campSlug: registration.campSlug,
        change,
      });
    }

    revalidatePath(`/registrations/${registration.id}`);
    revalidatePath("/registrations");

    // Hand the STORED form back. The panel adopts it, so the field cannot keep
    // showing `mah-1` after `MAH1` was written — and the Save button settles.
    return { campCode, erf };
  });
}

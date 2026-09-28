"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  parsePlacementAssignment,
  placementChange,
  placementNotification,
  shouldSendImmediateEmail,
  type PlacementAssignment,
  type PlacementChange,
} from "@quagga/core";

import { activeMembership } from "@quagga/db";
import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
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
// NOTIFIED ON FIRST ASSIGNMENT, ON EVERY CHANGE AND ON REMOVAL — in-app AND by
// immediate email (Ryan, 27 + 28 Sep 2026, epic #48). This file used to refuse
// to notify at all, on the grounds that an erf revised three times would send
// three pushes. The decision was that the camp hearing about each revision is
// worth it. What still does NOT notify is `placementChange` in @quagga/core
// returning null: re-saving the same values.

const AssignInput = z.object({
  registrationId: z.string().uuid(),
  // Both accept "" as "clear this field" — the form posts empty strings.
  campCode: z.string().max(64).nullish(),
  erf: z.string().max(128).nullish(),
});

/**
 * Tell a camp's leads/admins that AfrikaBurn set, changed or removed its
 * placement.
 *
 * Recipients are the camp's structural `lead`/`admin` memberships — the same
 * audience as a registration decision and a wrangler assignment. In-app, plus
 * an immediate email (docs/notifications-spec.md §Email): the payload's kind is
 * `registration`, which `shouldSendImmediateEmail` passes — the same path a
 * registration decision emails through. Env-less, `sendEmail` logs instead of
 * sending.
 *
 * Best-effort, after commit — the wrangler and registration-decision pattern: a
 * notification or email failure must never roll back a placement that is
 * already true.
 */
async function notifyPlacementChanged(
  db: ReturnType<typeof getDb>,
  input: {
    groupId: string;
    editionName: string;
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
          activeMembership(),
        ),
      );
    const userIds = [...new Set(leads.map((l) => l.userId))];
    if (userIds.length === 0) return;

    const payload = placementNotification({
      change: input.change,
      editionName: input.editionName,
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

    // Immediate email — the registration-decision path. One call per save;
    // `sendEmail` fans out one message per recipient, so no lead sees another's
    // address.
    if (shouldSendImmediateEmail(payload.kind)) {
      const recipients = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds));
      const to = recipients
        .map((r) => r.email)
        .filter((e): e is string => Boolean(e));
      if (to.length > 0) {
        const sent = await sendEmail({
          to,
          subject: payload.title,
          text: `${payload.title}${payload.body ? `\n\n${payload.body}` : ""}\n\nOpen the Contributors app to see details.`,
        });
        if (!sent.ok) {
          console.error("[notifications] placement email failed", sent.error);
        }
      }
    }
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
        // Named in the notice, so an old edition's change never reads as current.
        editionName: schema.editions.name,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.registrations.editionId),
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
        editionName: registration.editionName,
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

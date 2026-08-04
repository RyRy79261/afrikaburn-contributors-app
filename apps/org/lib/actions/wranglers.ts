"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  publicMemberName,
  shouldSendImmediateEmail,
  wranglerAssignedNotification,
} from "@quagga/core";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { runAction, type ActionResult } from "./result";

// Assigning a wrangler — AfrikaBurn's "dusty guardian angel" for one approved
// theme camp (migration 0026, roadmap M4-01/M4-08).
//
// THE CAPABILITY IS `update` IN `registrations`, the same one that decides a
// registration. Wrangling is the theme-camp leads team's job and it is the
// continuation of the review they just finished; inventing a separate domain
// would mean a department could own registrations without being able to hand
// the camp to anyone, which is not a boundary anybody asked for.
//
// APPROVAL IS THE GATE, and it is a server rule rather than a UI one. The
// review screen has promised "unlocks after approval" since it was a stub;
// AfrikaBurn's own process assigns the wrangler when the Theme Camp Committee
// accepts (docs/synthesis.md — "on acceptance the camp is assigned a Theme Camp
// Wrangler"), and our single approval IS that acceptance, because this model has
// no separate Form-1/Form-2 split.

const AssignInput = z.object({
  registrationId: z.string().uuid(),
  wranglerUserId: z.string().uuid(),
});

const UnassignInput = z.object({
  registrationId: z.string().uuid(),
});

/**
 * Tell the camp's leads/admins who their wrangler is, and tell the wrangler
 * which camp they now hold.
 *
 * TWO AUDIENCES, TWO PAYLOADS, AND NOBODY ELSE. The adversarial requirement on
 * this hook (roadmap M4-08) is that it reaches the assigned wrangler and the
 * camp — not every org member, not every camp. Both recipient lists below are
 * derived from ids this function was handed, never from a role or a broadcast
 * audience, which is the structural reason it cannot over-send.
 *
 * Best-effort, after commit: a notification failure must never roll back an
 * assignment that is already true.
 */
async function notifyWranglerAssigned(
  db: ReturnType<typeof getDb>,
  input: {
    groupId: string;
    campName: string;
    campSlug: string;
    wranglerUserId: string;
    wranglerName: string;
  },
): Promise<void> {
  try {
    // The camp side — the pre-written @quagga/core builder, unused until now.
    const leads = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, input.groupId),
          inArray(schema.memberships.role, ["lead", "admin"]),
        ),
      );
    const campUserIds = [...new Set(leads.map((l) => l.userId))].filter(
      // A wrangler who also leads this camp would otherwise get both halves of
      // the same news; the org-side copy is the one that tells them to act.
      (id) => id !== input.wranglerUserId,
    );

    const campPayload = wranglerAssignedNotification({
      wranglerName: input.wranglerName,
      campName: input.campName,
      campSlug: input.campSlug,
    });

    if (campUserIds.length > 0) {
      await insertNotifications(
        db,
        campUserIds.map((userId) => ({
          ...campPayload,
          userId,
          origin: "org" as const,
          // Written by the org, read in the participant app.
          linkApp: "web" as const,
        })),
      );
    }

    // The wrangler's own copy, phrased from their side and linking into the
    // CONSOLE, because that is where the work is.
    await insertNotifications(db, [
      {
        kind: "wrangler" as const,
        title: `You're now wrangling ${input.campName}`,
        body: "You'll help them through build week and check-in. Their registration is on your board.",
        link: "/wranglers",
        userId: input.wranglerUserId,
        origin: "org" as const,
        linkApp: "org" as const,
      },
    ]);

    if (shouldSendImmediateEmail("wrangler")) {
      const recipients = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(
          inArray(schema.users.id, [...campUserIds, input.wranglerUserId]),
        );
      const to = recipients
        .map((r) => r.email)
        .filter((e): e is string => Boolean(e));
      if (to.length > 0) {
        await sendEmail({
          to,
          subject: campPayload.title,
          text: `${campPayload.title}${campPayload.body ? `\n\n${campPayload.body}` : ""}\n\nOpen the Contributors app to see details.`,
        });
      }
    }
  } catch (err) {
    console.error("[notifications] wrangler assignment hook failed", err);
  }
}

/** Assign (or reassign) the wrangler for an approved camp. Audited. */
export async function assignWrangler(
  raw: z.input<typeof AssignInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = AssignInput.parse(raw);
    const db = getDb();

    const [registration] = await db
      .select({
        id: schema.registrations.id,
        status: schema.registrations.status,
        groupId: schema.registrations.groupId,
        editionId: schema.registrations.editionId,
        campName: schema.groups.name,
        campSlug: schema.groups.slug,
        campKind: schema.groups.kind,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    if (registration.campKind !== "theme_camp") {
      throw new Error(
        "Only theme camps get a wrangler — mutant vehicles and artworks are shepherded by the DMV and the Art crew.",
      );
    }
    if (registration.status !== "approved") {
      throw new Error(
        "A camp gets its wrangler when its registration is approved. Approve it first.",
      );
    }

    // THE PERSON MUST BE AN ORG MEMBER, checked here rather than trusted from
    // the picker: the picker is a client control and this action is a public
    // endpoint, so a hand-made request could otherwise hand a camp to any
    // account in the database — including one of its own members.
    const [wrangler] = await db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.groupId, session.orgGroupId),
          eq(schema.memberships.userId, input.wranglerUserId),
        ),
      )
      .limit(1);
    if (!wrangler) {
      throw new Error(
        "That account isn't an AfrikaBurn org member, so it can't hold a camp.",
      );
    }
    const wranglerName = publicMemberName(wrangler.username, {
      sanitizedAt: wrangler.sanitizedAt,
    });

    // The write and its audit row are one unit — an assignment that exists
    // without a record of who made it is the thing the trail is for.
    await withTransaction(async (tx) => {
      await tx
        .insert(schema.wranglerAssignments)
        .values({
          groupId: registration.groupId,
          editionId: registration.editionId,
          wranglerUserId: input.wranglerUserId,
          assignedByUserId: session.dbUserId,
        })
        // REASSIGNMENT REPLACES. The unique index on (group, edition) is what
        // makes this a swap rather than a second guardian angel; two reviewers
        // assigning at once therefore produce one winner and one overwrite,
        // both audited, instead of a camp with two wranglers and no owner.
        .onConflictDoUpdate({
          target: [
            schema.wranglerAssignments.groupId,
            schema.wranglerAssignments.editionId,
          ],
          set: {
            wranglerUserId: input.wranglerUserId,
            assignedByUserId: session.dbUserId,
            assignedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "wrangler.assign",
        subject: registration.groupId,
        meta: {
          registrationId: registration.id,
          editionId: registration.editionId,
          wranglerUserId: input.wranglerUserId,
        },
      });
    });

    await notifyWranglerAssigned(db, {
      groupId: registration.groupId,
      campName: registration.campName,
      campSlug: registration.campSlug,
      wranglerUserId: input.wranglerUserId,
      wranglerName,
    });

    revalidatePath(`/registrations/${registration.id}`);
    revalidatePath("/wranglers");
    revalidatePath("/");
  });
}

/**
 * Remove the wrangler from a camp. Audited, and NOT notified: "you are no
 * longer this camp's wrangler" is a conversation someone should have, not a
 * push notification, and telling the camp their guardian angel has gone without
 * telling them who is next is worse than telling them nothing.
 */
export async function unassignWrangler(
  raw: z.input<typeof UnassignInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = UnassignInput.parse(raw);
    const db = getDb();

    const [registration] = await db
      .select({
        id: schema.registrations.id,
        groupId: schema.registrations.groupId,
        editionId: schema.registrations.editionId,
      })
      .from(schema.registrations)
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    await withTransaction(async (tx) => {
      const removed = await tx
        .delete(schema.wranglerAssignments)
        .where(
          and(
            eq(schema.wranglerAssignments.groupId, registration.groupId),
            eq(schema.wranglerAssignments.editionId, registration.editionId),
          ),
        )
        .returning({
          wranglerUserId: schema.wranglerAssignments.wranglerUserId,
        });
      if (removed.length === 0) {
        throw new Error("That camp doesn't have a wrangler to remove.");
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "wrangler.unassign",
        subject: registration.groupId,
        meta: {
          registrationId: registration.id,
          editionId: registration.editionId,
          wranglerUserId: removed[0]?.wranglerUserId ?? null,
        },
      });
    });

    revalidatePath(`/registrations/${registration.id}`);
    revalidatePath("/wranglers");
    revalidatePath("/");
  });
}

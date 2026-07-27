"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  buildBulletinNotifications,
  canActivateAudience,
  resolveBulletinAudience,
  ORG_RANK_LABELS,
  type AuthzMembership,
} from "@quagga/core";
import { BulletinComposeInput } from "@quagga/types";

import { schema, withTransaction, type DbHandle } from "@/lib/db";
import { requireOrgSession, type OrgSession } from "@/lib/session";
import { getActiveEdition } from "@/lib/queries";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { buildAudienceContext } from "@/lib/questionnaires/queries";
import { runAction, type ActionResult } from "./result";

// Bulletin CRUD. Two server-side gates, both of which must pass: the console
// capability (`write`) and the core audience predicate `canActivateAudience`,
// which admits only org AUTHORS (god / org_staff). That second gate is what
// keeps an ENGINEER out of broadcasting: an engineer holds `write` for console
// operations, but announcing things to burners in AfrikaBurn's name is not IT
// work and the authoring predicate never listed the rank. Bulletins are
// broadcasts to an org audience; project audiences are rejected (those are
// camp-scoped questionnaires, not org bulletins). Informational only — no data
// collection.

function authzMemberships(session: OrgSession): AuthzMembership[] {
  return [{ groupId: session.orgGroupId, role: session.role }];
}

/** Assert the actor may target this (org-only) audience. Throws otherwise. */
function assertOrgAudience(session: OrgSession, input: BulletinComposeInput) {
  if (input.audience.kind === "project") {
    throw new Error("Bulletins broadcast to org audiences, not a single camp.");
  }
  if (
    !canActivateAudience(
      authzMemberships(session),
      input.audience,
      session.orgGroupId,
    )
  ) {
    throw new Error(broadcastRefusal(session));
  }
}

/** The refusal an actor gets for a broadcast, named to their rank so it reads
 * as a rule rather than a glitch. */
function broadcastRefusal(session: OrgSession): string {
  return session.role === "engineer"
    ? `${ORG_RANK_LABELS.engineer} accounts don't broadcast to burners in AfrikaBurn's name — ask org staff to send it.`
    : "You are not allowed to broadcast to that audience.";
}

const SaveInput = BulletinComposeInput.extend({
  id: z.string().uuid().optional(),
});

export type SaveBulletinResult =
  { ok: true; id: string } | { ok: false; error: string };

/**
 * Create or update a bulletin. `publish: true` stamps `published_at` and fans
 * out one notification per resolved recipient (idempotent-ish: publishing an
 * already-published bulletin re-resolves and would re-notify, so the action
 * refuses to re-publish an already-published row). Draft edits never notify.
 */
export async function saveBulletin(
  raw: z.input<typeof SaveInput>,
): Promise<SaveBulletinResult> {
  try {
    const session = await requireOrgSession({ capability: "write" });
    const input = SaveInput.parse(raw);
    assertOrgAudience(session, input);

    const edition = await getActiveEdition();
    if (!edition)
      throw new Error("No active edition to attach the bulletin to.");

    const now = new Date();

    // --- Update path -----------------------------------------------------
    // The row write, the notification fan-out (on publish) and the audit row
    // are one atomic unit — a published bulletin must never exist without its
    // recipients' notifications, nor notifications without the published row.
    if (input.id) {
      await withTransaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: schema.bulletins.id,
            publishedAt: schema.bulletins.publishedAt,
          })
          .from(schema.bulletins)
          .where(eq(schema.bulletins.id, input.id!))
          .limit(1);
        if (!existing) throw new Error("That bulletin no longer exists.");
        const alreadyPublished = existing.publishedAt !== null;

        await tx
          .update(schema.bulletins)
          .set({
            title: input.title,
            bodyMd: input.bodyMd,
            audience: input.audience,
            pinned: input.pinned,
            // Publishing a draft stamps published_at; never un-publish or restamp.
            ...(input.publish && !alreadyPublished ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(schema.bulletins.id, input.id!));

        if (input.publish && !alreadyPublished) {
          await fanOut(
            tx,
            input.id!,
            input.title,
            input.audience,
            edition.id,
            session,
          );
        }

        await writeAuditEvent(tx, {
          actorId: session.dbUserId,
          action:
            input.publish && !alreadyPublished
              ? "bulletin.publish"
              : "bulletin.update",
          subject: input.id!,
        });
      });

      revalidatePath("/bulletins");
      revalidatePath(`/bulletins/${input.id}`);
      return { ok: true, id: input.id };
    }

    // --- Create path -----------------------------------------------------
    const createdId = await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(schema.bulletins)
        .values({
          editionId: edition.id,
          title: input.title,
          bodyMd: input.bodyMd,
          audience: input.audience,
          createdByUserId: session.dbUserId,
          pinned: input.pinned,
          publishedAt: input.publish ? now : null,
        })
        .returning({ id: schema.bulletins.id });
      if (!created) throw new Error("Could not create the bulletin.");

      if (input.publish) {
        await fanOut(
          tx,
          created.id,
          input.title,
          input.audience,
          edition.id,
          session,
        );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: input.publish ? "bulletin.publish" : "bulletin.create",
        subject: created.id,
      });

      return created.id;
    });

    revalidatePath("/bulletins");
    return { ok: true, id: createdId };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not save the bulletin.",
    };
  }
}

/** Resolve the audience and fan out bulletin notifications (shared resolver). */
async function fanOut(
  db: DbHandle,
  bulletinId: string,
  title: string,
  audience: BulletinComposeInput["audience"],
  editionId: string,
  session: OrgSession,
): Promise<void> {
  const ctx = await buildAudienceContext(editionId, session.orgGroupId);
  const userIds = resolveBulletinAudience(audience, ctx);
  const rows = buildBulletinNotifications({ bulletinId, title }, userIds);
  // linkApp stays NULL for bulletins, and that is correct rather than lazy:
  // /bulletins/<id> now exists in all three apps and each authorises the read
  // from the recipient's own notification row, so the same relative path
  // resolves wherever the recipient happens to read it. A supplier and a burner
  // in one audience genuinely need different hosts, and null ("treat as local")
  // is the only value that is right for both.
  await insertNotifications(
    db,
    rows.map((r) => ({ ...r, origin: "org" as const, linkApp: null })),
  );
}

const PublishInput = z.object({ id: z.string().uuid() });

/** Publish an existing draft bulletin (fan-out). Org authors only. */
export async function publishBulletin(
  raw: z.input<typeof PublishInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "write" });
    const input = PublishInput.parse(raw);

    // Guard read, publish stamp, fan-out and audit are one atomic unit.
    await withTransaction(async (tx) => {
      const [bulletin] = await tx
        .select()
        .from(schema.bulletins)
        .where(eq(schema.bulletins.id, input.id))
        .limit(1);
      if (!bulletin) throw new Error("That bulletin no longer exists.");
      if (bulletin.publishedAt !== null) {
        throw new Error("That bulletin is already published.");
      }
      // Re-check the stored audience is one this actor may broadcast to.
      if (
        bulletin.audience.kind === "project" ||
        !canActivateAudience(
          authzMemberships(session),
          bulletin.audience,
          session.orgGroupId,
        )
      ) {
        throw new Error(broadcastRefusal(session));
      }

      const now = new Date();
      await tx
        .update(schema.bulletins)
        .set({ publishedAt: now, updatedAt: now })
        .where(eq(schema.bulletins.id, input.id));

      await fanOut(
        tx,
        bulletin.id,
        bulletin.title,
        bulletin.audience,
        bulletin.editionId,
        session,
      );

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "bulletin.publish",
        subject: bulletin.id,
      });
    });

    revalidatePath("/bulletins");
    revalidatePath(`/bulletins/${input.id}`);
  });
}

const SetPinnedInput = z.object({ id: z.string().uuid(), pinned: z.boolean() });

/** Toggle a bulletin's pinned state. Needs `write`. */
export async function setBulletinPinned(
  raw: z.input<typeof SetPinnedInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({ capability: "write" });
    const input = SetPinnedInput.parse(raw);
    // Pin toggle + audit are one atomic unit.
    await withTransaction(async (tx) => {
      await tx
        .update(schema.bulletins)
        .set({ pinned: input.pinned, updatedAt: new Date() })
        .where(eq(schema.bulletins.id, input.id));
      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "bulletin.pin",
        subject: input.id,
        meta: { pinned: input.pinned },
      });
    });
    revalidatePath("/bulletins");
  });
}

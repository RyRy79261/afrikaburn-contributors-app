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
import { BulletinComposeInput, type AudienceSpec } from "@quagga/types";

import { schema, withTransaction, type DbHandle } from "@/lib/db";
import { requireOrgSession, type OrgSession } from "@/lib/session";
import { getActiveEdition } from "@/lib/queries";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { buildAudienceContext } from "@/lib/questionnaires/queries";
import { runAction, type ActionResult } from "./result";

// Bulletin CRUD. Two server-side gates, both of which must pass: the console
// capability in the `bulletins` domain — `create` to compose a new one,
// `update` to change one that exists — and the core audience predicate
// `canActivateAudience`, which admits only org AUTHORS (god / org_staff).
// Naming the right verb per path matters: while every write asked for
// `update`, a role deliberately given "may correct, may not compose" could
// still broadcast in AfrikaBurn's name. That second gate is what keeps an
// ENGINEER out of broadcasting: the seeded Engineer role holds `create` and
// `update` for console operations, but announcing things to burners in
// AfrikaBurn's name is not IT work and the authoring predicate never listed
// the rank. Bulletins are broadcasts to an org audience; project audiences are
// rejected (those are camp-scoped questionnaires, not org bulletins).
// Informational only — no data collection.

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

/**
 * A comparable key for an audience spec, so "is this the same audience?" is one
 * answer rather than a structural walk at each call site. Order-insensitive on
 * the selector arrays: `["a","b"]` and `["b","a"]` reach exactly the same people
 * and must not read as a change.
 */
function audienceKey(spec: AudienceSpec): string {
  switch (spec.kind) {
    case "org_outbound":
      return `org_outbound:${[...spec.selectors].sort().join(",")}`;
    case "org_officer":
      return `org_officer:${[...spec.officerKeys].sort().join(",")}`;
    case "project":
      return `project:${spec.groupId}:${spec.mode}:${[...spec.roleIds].sort().join(",")}`;
    case "org_internal":
    case "org_suppliers":
      return spec.kind;
  }
}

/**
 * WHAT A PUBLISHED BULLETIN WILL NOT LET YOU CHANGE, said to the author.
 *
 * Ryan, 28 Jul 2026: title and audience are frozen after publish, the body
 * stays editable, and an edit sends nothing new. The reason is that the fan-out
 * already happened: every recipient's notification row carries the title as it
 * was sent, and the audience that resolved to those rows cannot be re-aimed
 * after the fact. Rewriting either left the console's own "sent to N people"
 * detail describing a broadcast that never took place.
 */
const PUBLISHED_FROZEN_MESSAGE =
  "This bulletin has already gone out. Its title and audience are fixed — recipients' notifications carry the title it was sent with, and a broadcast cannot be re-aimed afterwards. Correct the body here, or send a new bulletin.";

export type SaveBulletinResult =
  { ok: true; id: string } | { ok: false; error: string };

/**
 * Create or update a bulletin. `publish: true` stamps `published_at` and fans
 * out one notification per resolved recipient (idempotent-ish: publishing an
 * already-published bulletin re-resolves and would re-notify, so the action
 * refuses to re-publish an already-published row). Draft edits never notify,
 * and neither does an edit to a published one — see `PUBLISHED_FROZEN_MESSAGE`.
 */
export async function saveBulletin(
  raw: z.input<typeof SaveInput>,
): Promise<SaveBulletinResult> {
  try {
    // WHICH capability this needs depends on which path it takes, so the id is
    // read off the raw input BEFORE the parse. Both paths used to ask for
    // `update`, which meant a role holding only `update` — "may correct what is
    // already there" — could compose a brand-new bulletin and broadcast it in
    // AfrikaBurn's name without ever holding `create`. Reading the raw id is
    // safe: `SaveInput` below rejects an id that is not a uuid string, so
    // anything that reaches a write took the path it was checked for.
    const isUpdate = typeof (raw as { id?: unknown } | null)?.id === "string";
    const session = await requireOrgSession({
      capability: isUpdate ? "update" : "create",
      domain: "bulletins",
    });
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
        // `for update` LOCKS the row for the rest of the transaction. Without
        // it the already-published guard below is a plain read that two
        // concurrent publishes both pass, and the whole audience receives the
        // same bulletin twice. The lock makes "is it published?" and "stamp it
        // and fan out" one indivisible step.
        const [existing] = await tx
          .select({
            id: schema.bulletins.id,
            title: schema.bulletins.title,
            audience: schema.bulletins.audience,
            publishedAt: schema.bulletins.publishedAt,
          })
          .from(schema.bulletins)
          .where(eq(schema.bulletins.id, input.id!))
          .limit(1)
          .for("update");
        if (!existing) throw new Error("That bulletin no longer exists.");
        const alreadyPublished = existing.publishedAt !== null;

        // Refuse the frozen edits rather than dropping them silently: the
        // composer posts the whole form back, so a discarded title change would
        // toast "Bulletin saved." over a title that did not move.
        if (
          alreadyPublished &&
          (input.title !== existing.title ||
            audienceKey(input.audience) !== audienceKey(existing.audience))
        ) {
          throw new Error(PUBLISHED_FROZEN_MESSAGE);
        }

        await tx
          .update(schema.bulletins)
          .set({
            // Title and audience are only the author's to set while the
            // bulletin is still a draft. Once it has gone out they are the
            // record of WHAT WAS SENT, so a published row keeps its own.
            ...(alreadyPublished
              ? {}
              : { title: input.title, audience: input.audience }),
            bodyMd: input.bodyMd,
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
    const session = await requireOrgSession({
      capability: "update",
      domain: "bulletins",
    });
    const input = PublishInput.parse(raw);

    // Guard read, publish stamp, fan-out and audit are one atomic unit.
    await withTransaction(async (tx) => {
      // `for update` is what makes the already-published guard below actually
      // hold. A transaction is not on its own a lock: two publishes racing the
      // same draft (a double-clicked button, two staff on the same row) both
      // read `published_at IS NULL`, both passed, and both fanned out — the
      // whole audience got the notice twice, and nothing in the console said
      // why. The lock serialises them, so the second one finds the row
      // published and is refused.
      const [bulletin] = await tx
        .select()
        .from(schema.bulletins)
        .where(eq(schema.bulletins.id, input.id))
        .limit(1)
        .for("update");
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

/** Toggle a bulletin's pinned state. Needs `update` on `bulletins`. */
export async function setBulletinPinned(
  raw: z.input<typeof SetPinnedInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "bulletins",
    });
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

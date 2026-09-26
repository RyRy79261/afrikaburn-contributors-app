"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  ANNOUNCEMENT_MESSAGES,
  canSendCampAnnouncement,
  hasProjectPermission,
  validateSendAt,
} from "@quagga/core";
import {
  CampAnnouncementDraftInput,
  type ProjectAudience,
} from "@quagga/types";

import { db, schema } from "@/lib/db";
import { getActiveEdition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  deleteCampAnnouncementDraft,
  getSenderContext,
  publishCampAnnouncement,
  saveCampAnnouncementDraft,
  setCampAnnouncementPinned,
  type SenderContext,
} from "@/lib/announcements-store";

// Camp announcement actions (epic #56). Zod at the boundary; the permission
// answered here is a SNAPSHOT used to refuse early with a clear sentence — the
// store's publish and pin transactions re-read and lock it themselves, so a
// sender demoted between this check and the write is still refused.
//
// NEVER the org group: org broadcasts are authored in the console, and a
// participant-app action that resolved the org's slug would be one permission
// check away from sending in AfrikaBurn's name.

export type AnnouncementActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

const NOT_A_SENDER =
  "You don't have permission to post announcements for this camp.";

async function campForSlug(slug: string): Promise<{ id: string } | null> {
  const [group] = await db()
    .select({ id: schema.groups.id, kind: schema.groups.kind })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind === "org") return null;
  return { id: group.id };
}

/** Resolve the camp and the caller as a sender, or say why not. */
async function requireSender(
  slug: string,
): Promise<
  | { ok: true; groupId: string; userId: string; sender: SenderContext }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const camp = await campForSlug(slug);
  if (!camp) return { ok: false, error: "Camp not found." };
  const sender = await getSenderContext(camp.id, user.id);
  if (!sender || !hasProjectPermission(sender.perms, "post_announcements")) {
    return { ok: false, error: NOT_A_SENDER };
  }
  return { ok: true, groupId: camp.id, userId: user.id, sender };
}

function revalidateAnnouncements(slug: string, id?: string) {
  revalidatePath(`/camps/${slug}/announcements`);
  if (id) revalidatePath(`/camps/${slug}/announcements/${id}`);
  revalidatePath(`/camps/${slug}`);
}

/** Save (create or edit) the caller's own draft. Reaches nobody. */
export async function saveAnnouncementDraftAction(
  raw: unknown,
): Promise<AnnouncementActionResult<{ id: string }>> {
  const parsed = CampAnnouncementDraftInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the announcement.",
    };
  }
  const input = parsed.data;
  const gate = await requireSender(input.slug);
  if (!gate.ok) return gate;

  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  const audience: ProjectAudience = {
    kind: "project",
    groupId: gate.groupId,
    mode: input.mode,
    roleIds: input.mode === "roles" ? input.roleIds : [],
  };
  if (
    !canSendCampAnnouncement(gate.sender.perms, {
      groupId: gate.groupId,
      audience,
      presentation: input.presentation,
      baselineRoleId: gate.sender.baselineRoleId,
      campRoleIds: gate.sender.campRoleIds,
    })
  ) {
    return {
      ok: false,
      error:
        input.mode === "roles" && input.roleIds.length === 0
          ? "Pick at least one role, or send to the whole camp."
          : ANNOUNCEMENT_MESSAGES.notAllowed,
    };
  }

  const sendAt = input.sendAt ? new Date(input.sendAt) : null;
  const schedule = validateSendAt(sendAt, new Date());
  if (!schedule.ok) return schedule;

  const result = await saveCampAnnouncementDraft({
    groupId: gate.groupId,
    editionId: edition.id,
    actorId: gate.userId,
    id: input.id,
    fields: {
      title: input.title,
      bodyMd: input.bodyMd,
      audience,
      presentation: input.presentation,
      pinOnPublish: input.pinOnPublish,
      meetingUrl: input.meetingUrl,
      sendAt: schedule.sendAt,
    },
  });
  if (result.ok) revalidateAnnouncements(input.slug, result.id);
  return result;
}

const IdInput = z.object({
  slug: z.string().min(1),
  id: z.string().uuid(),
});

/** Delete the caller's own draft. Published announcements are immutable. */
export async function deleteAnnouncementDraftAction(
  raw: unknown,
): Promise<AnnouncementActionResult> {
  const parsed = IdInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: ANNOUNCEMENT_MESSAGES.missing };
  const gate = await requireSender(parsed.data.slug);
  if (!gate.ok) return gate;
  const result = await deleteCampAnnouncementDraft({
    groupId: gate.groupId,
    id: parsed.data.id,
    actorId: gate.userId,
  });
  if (result.ok) revalidateAnnouncements(parsed.data.slug);
  return result;
}

/**
 * Publish the caller's own draft — now, or at its scheduled time. The store
 * re-checks the audience against locked rows inside the claim's transaction.
 */
export async function publishAnnouncementAction(
  raw: unknown,
): Promise<
  AnnouncementActionResult<{ recipients: number; scheduledFor: string | null }>
> {
  const parsed = IdInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: ANNOUNCEMENT_MESSAGES.missing };
  const gate = await requireSender(parsed.data.slug);
  if (!gate.ok) return gate;
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  const result = await publishCampAnnouncement({
    groupId: gate.groupId,
    id: parsed.data.id,
    actorId: gate.userId,
    activeEditionId: edition.id,
  });
  if (!result.ok) return result;
  revalidateAnnouncements(parsed.data.slug, parsed.data.id);
  return {
    ok: true,
    recipients: result.recipients,
    scheduledFor: result.scheduledFor?.toISOString() ?? null,
  };
}

const PinInput = IdInput.extend({ pinned: z.boolean() });

/** Pin or unpin a delivered announcement (posting authority over its audience). */
export async function setAnnouncementPinnedAction(
  raw: unknown,
): Promise<AnnouncementActionResult> {
  const parsed = PinInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: ANNOUNCEMENT_MESSAGES.missing };
  const gate = await requireSender(parsed.data.slug);
  if (!gate.ok) return gate;
  const result = await setCampAnnouncementPinned({
    groupId: gate.groupId,
    id: parsed.data.id,
    actorId: gate.userId,
    pinned: parsed.data.pinned,
  });
  if (result.ok) revalidateAnnouncements(parsed.data.slug, parsed.data.id);
  return result;
}

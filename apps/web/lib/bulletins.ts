import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { sortPinned } from "@quagga/core";
import type { AnnouncementPresentation } from "@quagga/types";

import { db, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { getCurrentCampUser } from "./session";

// Participant-side bulletin reads (docs/notifications-spec.md §Surfaces).
// A bulletin is only readable by a participant who RECEIVED it — i.e. has a
// notification row for it. This is the read-side enforcement of the same
// audience: an org_internal bulletin (or any broadcast a user wasn't in the
// audience for) is never viewable, so previews/pages can't leak org-internal
// broadcasts into participant surfaces.
//
// CAMP ANNOUNCEMENTS (epic #56) ride the same rule unchanged: they are
// bulletins with a `group_id`, and the delivery row is the permission. A
// member outside the audience, a member of another camp, the org, a stranger —
// every one of them gets `null` here, which the page turns into the SAME 404 a
// non-existent id gets. "Not for you" and "doesn't exist" are one answer.

export interface ParticipantBulletin {
  id: string;
  title: string;
  bodyMd: string;
  pinned: boolean;
  publishedAt: Date | null;
  /** Null for an AfrikaBurn bulletin; the camp for a camp announcement. */
  groupId: string | null;
  campName: string | null;
  presentation: AnnouncementPresentation;
  meetingUrl: string | null;
  /** The reader's OWN acknowledgement, if any. */
  acknowledgedAt: Date | null;
}

/** A published bulletin the CURRENT user received, else null (404-safe). */
export async function getBulletinForCurrentUser(
  id: string,
): Promise<ParticipantBulletin | null> {
  if (!isDatabaseConfigured()) return null;
  const user = await getCurrentCampUser();
  if (!user) return null;

  // One read, joined THROUGH the caller's own delivery row: no delivery, no
  // row. The camp name rides a left join (null for org bulletins).
  const [row] = await db()
    .select({
      id: schema.bulletins.id,
      title: schema.bulletins.title,
      bodyMd: schema.bulletins.bodyMd,
      pinned: schema.bulletins.pinned,
      publishedAt: schema.bulletins.publishedAt,
      groupId: schema.bulletins.groupId,
      campName: schema.groups.name,
      presentation: schema.bulletins.presentation,
      meetingUrl: schema.bulletins.meetingUrl,
      acknowledgedAt: schema.notifications.acknowledgedAt,
    })
    .from(schema.notifications)
    .innerJoin(
      schema.bulletins,
      eq(schema.bulletins.id, schema.notifications.bulletinId),
    )
    .leftJoin(schema.groups, eq(schema.groups.id, schema.bulletins.groupId))
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.bulletinId, id),
      ),
    )
    .limit(1);
  if (!row || row.publishedAt === null) return null;
  return row;
}

/** A pinned bulletin as the dashboard banner shows it. */
export interface PinnedBulletin {
  id: string;
  title: string;
  groupId: string | null;
  campName: string | null;
  pinnedAt: Date;
  fromOrg: boolean;
}

/**
 * Pinned, published bulletins the CURRENT user received — the Camp Dashboard
 * pinned banner (Landing stays marketing-clean, per spec) — in `sortPinned`
 * order (newest pin first). With `groupId`, a camp's dashboard shows
 * AfrikaBurn's pins plus THAT camp's own, never another camp's.
 *
 * The audience is not re-resolved here and must not be: the join through the
 * member's own delivery row IS the audience, settled at fan-out. A draft has
 * no deliveries, so a pinned draft never shows; a member outside the roles an
 * announcement went to never sees its pin. There is no dismiss — a pin stays
 * until its author unpins it.
 */
export async function getPinnedBulletinsForCurrentUser(
  groupId?: string,
): Promise<PinnedBulletin[]> {
  if (!isDatabaseConfigured()) return [];
  const user = await getCurrentCampUser();
  if (!user) return [];

  const rows = await db()
    .select({
      id: schema.bulletins.id,
      title: schema.bulletins.title,
      groupId: schema.bulletins.groupId,
      campName: schema.groups.name,
      pinnedAt: schema.bulletins.pinnedAt,
      publishedAt: schema.bulletins.publishedAt,
    })
    .from(schema.bulletins)
    .innerJoin(
      schema.notifications,
      eq(schema.notifications.bulletinId, schema.bulletins.id),
    )
    .leftJoin(schema.groups, eq(schema.groups.id, schema.bulletins.groupId))
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.bulletins.pinned, true),
        isNotNull(schema.bulletins.publishedAt),
      ),
    );

  return sortPinned(
    rows.flatMap((r) => {
      if (groupId !== undefined && r.groupId !== null && r.groupId !== groupId)
        return [];
      // An org pin made before `pinned_at` existed orders by its publish time.
      const pinnedAt = r.pinnedAt ?? r.publishedAt;
      if (!pinnedAt) return [];
      return [
        {
          id: r.id,
          title: r.title,
          groupId: r.groupId,
          campName: r.campName,
          pinnedAt,
          fromOrg: r.groupId === null,
        },
      ];
    }),
  );
}

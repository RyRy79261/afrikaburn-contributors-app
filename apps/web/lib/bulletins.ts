import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { getCurrentCampUser } from "./session";

// Participant-side bulletin reads (docs/notifications-spec.md §Surfaces).
// A bulletin is only readable by a participant who RECEIVED it — i.e. has a
// notification row for it. This is the read-side enforcement of the same
// audience: an org_internal bulletin (or any broadcast a user wasn't in the
// audience for) is never viewable, so previews/pages can't leak org-internal
// broadcasts into participant surfaces.

export interface ParticipantBulletin {
  id: string;
  title: string;
  bodyMd: string;
  pinned: boolean;
  publishedAt: Date | null;
}

/** A published bulletin the CURRENT user received, else null (404-safe). */
export async function getBulletinForCurrentUser(
  id: string,
): Promise<ParticipantBulletin | null> {
  if (!isDatabaseConfigured()) return null;
  const user = await getCurrentCampUser();
  if (!user) return null;

  // The user must have a notification for this bulletin (⇒ they were targeted).
  const [received] = await db()
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.bulletinId, id),
      ),
    )
    .limit(1);
  if (!received) return null;

  const [bulletin] = await db()
    .select({
      id: schema.bulletins.id,
      title: schema.bulletins.title,
      bodyMd: schema.bulletins.bodyMd,
      pinned: schema.bulletins.pinned,
      publishedAt: schema.bulletins.publishedAt,
    })
    .from(schema.bulletins)
    .where(eq(schema.bulletins.id, id))
    .limit(1);
  if (!bulletin || bulletin.publishedAt === null) return null;
  return bulletin;
}

/**
 * Pinned, published bulletins the CURRENT user received — the Camp Dashboard
 * pinned banner (Landing stays marketing-clean, per spec). Newest first.
 */
export async function getPinnedBulletinsForCurrentUser(): Promise<
  ParticipantBulletin[]
> {
  if (!isDatabaseConfigured()) return [];
  const user = await getCurrentCampUser();
  if (!user) return [];

  const rows = await db()
    .select({
      id: schema.bulletins.id,
      title: schema.bulletins.title,
      bodyMd: schema.bulletins.bodyMd,
      pinned: schema.bulletins.pinned,
      publishedAt: schema.bulletins.publishedAt,
    })
    .from(schema.bulletins)
    .innerJoin(
      schema.notifications,
      eq(schema.notifications.bulletinId, schema.bulletins.id),
    )
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.bulletins.pinned, true),
      ),
    )
    .orderBy(desc(schema.bulletins.publishedAt));

  return rows.filter((b) => b.publishedAt !== null);
}

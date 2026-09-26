import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "./db";

// The RECIPIENT side of camp announcements (epic #56): the must-acknowledge
// gate's read, the acknowledgement write, and "opened" (read_at). Kept apart
// from announcements-store.ts on purpose: lib/session.ts reads the gate on
// every render, and this module depends on nothing but the database handle, so
// the session module never pulls the author-side store (and its roles /
// notifications imports, which import session back) into a cycle.
//
// Every statement here is keyed on the CALLER's own user id. There is no input
// that names another member's delivery.

/**
 * Acknowledge a must-acknowledge announcement: stamps `acknowledged_at` (and
 * `read_at`, if still unread) on the CALLER'S OWN delivery row only — the WHERE
 * is keyed on their user id, so no input can acknowledge for anyone else.
 * Idempotent: acknowledging twice is not an error. False when the caller has no
 * such delivery (answered exactly as a non-existent id).
 */
export async function acknowledgeAnnouncement(input: {
  userId: string;
  bulletinId: string;
}): Promise<boolean> {
  const now = new Date();
  // Only a MUST-ACKNOWLEDGE announcement can be acknowledged; a feed item or
  // an org bulletin has nothing to stamp.
  const mustAcknowledge = sql`exists (select 1 from ${schema.bulletins} where ${schema.bulletins.id} = ${schema.notifications.bulletinId} and ${schema.bulletins.presentation} = 'acknowledge')`;
  const stamped = await db()
    .update(schema.notifications)
    .set({
      acknowledgedAt: now,
      readAt: sql`coalesce(${schema.notifications.readAt}, ${now})`,
    })
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.bulletinId, input.bulletinId),
        isNull(schema.notifications.acknowledgedAt),
        mustAcknowledge,
      ),
    )
    .returning({ id: schema.notifications.id });
  if (stamped[0]) return true;
  // Already acknowledged is success; anything else is "no such thing".
  const [existing] = await db()
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.bulletinId, input.bulletinId),
        isNotNull(schema.notifications.acknowledgedAt),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

/**
 * The oldest must-acknowledge announcement this user has received and not yet
 * acknowledged, or null. Feeds the app-wide hard gate (lib/session.ts), after
 * any blocking required action. Only PUBLISHED announcements count — the same
 * rule the reader applies, so the gate never sends anyone to a page that 404s.
 */
export async function firstUnacknowledgedAnnouncement(
  userId: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ bulletinId: schema.notifications.bulletinId })
    .from(schema.notifications)
    .innerJoin(
      schema.bulletins,
      eq(schema.bulletins.id, schema.notifications.bulletinId),
    )
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.acknowledgedAt),
        eq(schema.bulletins.presentation, "acknowledge"),
        // The reader's published rule (lib/bulletins.ts): an unpublished row
        // 404s there, so gating on one would redirect to a 404 forever.
        isNotNull(schema.bulletins.publishedAt),
      ),
    )
    .orderBy(asc(schema.notifications.createdAt))
    .limit(1);
  return row?.bulletinId ?? null;
}

/**
 * Mark the caller's own delivery of an announcement READ — "opened" is what the
 * author's read count counts. No-op when already read or never received.
 */
export async function markAnnouncementRead(input: {
  userId: string;
  bulletinId: string;
}): Promise<void> {
  await db()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.bulletinId, input.bulletinId),
        isNull(schema.notifications.readAt),
      ),
    );
}

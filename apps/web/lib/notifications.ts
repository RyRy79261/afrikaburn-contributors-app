import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@quagga/db";
import {
  groupNotificationsByDay,
  type DayGroup,
  type NotificationRow,
} from "@quagga/core";
import type { NotificationFilter, NotificationKind } from "@quagga/types";

import { db, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { getCurrentCampUser } from "./session";

// Notifications backend for the participant app (docs/notifications-spec.md).
// The header bell reads `getUnreadNotificationCount`; the /notifications surface
// reads `listNotificationGroups`. Event hooks write via `insertNotifications`.
// Every read is scoped to the CURRENT user server-side — a caller can never see
// another account's inbox.

/**
 * Unread count for the header bell. Real per-user query (swaps the wave-1
 * placeholder seam). Env-less / signed-out → 0 so the chrome still renders.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const user = await getCurrentCampUser();
  if (!user) return 0;
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        isNull(schema.notifications.readAt),
      ),
    );
  return row?.count ?? 0;
}

/** One inbox row as the /notifications surface consumes it. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  bulletinId: string | null;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * The current user's notifications, newest first, optionally filtered, grouped
 * by day for the list UI. Returns an empty list env-less / signed-out.
 */
export async function listNotificationGroups(
  filter: NotificationFilter = "all",
): Promise<DayGroup<NotificationView>[]> {
  if (!isDatabaseConfigured()) return [];
  const user = await getCurrentCampUser();
  if (!user) return [];

  const conds = [eq(schema.notifications.userId, user.id)];
  if (filter === "unread") conds.push(isNull(schema.notifications.readAt));
  if (filter === "bulletins")
    conds.push(eq(schema.notifications.kind, "bulletin"));

  const rows = await db()
    .select()
    .from(schema.notifications)
    .where(and(...conds))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(200);

  return groupNotificationsByDay(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      link: r.link,
      bulletinId: r.bulletinId,
      createdAt: r.createdAt,
      readAt: r.readAt,
    })),
  );
}

/** Latest ~n notifications flat (the header dropdown panel). */
export async function recentNotifications(
  limit = 6,
): Promise<NotificationView[]> {
  if (!isDatabaseConfigured()) return [];
  const user = await getCurrentCampUser();
  if (!user) return [];
  const rows = await db()
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    bulletinId: r.bulletinId,
    createdAt: r.createdAt,
    readAt: r.readAt,
  }));
}

/**
 * Insert notification rows (the event-hook + bulletin-fan-out writer). Accepts
 * an explicit db handle so hooks that already hold one reuse it. No-op on an
 * empty batch. Rows come from the @quagga/core payload builders, which never
 * carry hard-locked private fields.
 */
export async function insertNotifications(
  handle: Database,
  rows: readonly NotificationRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await handle.insert(schema.notifications).values(
    rows.map((r) => ({
      userId: r.userId,
      kind: r.kind,
      title: r.title,
      body: r.body ?? null,
      link: r.link ?? null,
      bulletinId: r.bulletinId ?? null,
    })),
  );
}

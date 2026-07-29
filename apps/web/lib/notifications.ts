import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@quagga/db";
import {
  groupNotificationsByDay,
  notificationLinkIsLocal,
  type DayGroup,
  type NotificationRow,
  resolveNotificationLinkApp,
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
      // A link minted for ANOTHER app is a path this one cannot serve —
      // render the row without a link rather than a guaranteed 404.
      // Null linkApp (pre-migration rows) counts as local.
      link: notificationLinkIsLocal(r.linkApp, "web") ? r.link : null,
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
    // A link minted for ANOTHER app is a path this one cannot serve —
    // render the row unlinked rather than as a guaranteed 404. Null
    // linkApp (every pre-migration row) counts as local.
    link: notificationLinkIsLocal(r.linkApp, "web") ? r.link : null,
    bulletinId: r.bulletinId,
    createdAt: r.createdAt,
    readAt: r.readAt,
  }));
}

/** Rows per INSERT. Eight bound columns each, so Postgres' 65535-parameter
 * ceiling lands at 8191 rows — 1000 keeps a wide margin. */
const NOTIFICATION_INSERT_CHUNK = 1000;

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
  // CHUNKED. Six bound parameters per row against Postgres' 65535-parameter
  // ceiling means a single insert dies at 10923 rows with SQLSTATE 08P01 —
  // and because a bulletin publish wraps this in a transaction, the whole
  // broadcast rolled back. AfrikaBurn is comfortably bigger than 10922 people,
  // so this was a live ceiling on the participant fan-out, not a theoretical one.
  for (let i = 0; i < rows.length; i += NOTIFICATION_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + NOTIFICATION_INSERT_CHUNK);
    await handle.insert(schema.notifications).values(
      chunk.map((r) => ({
        userId: r.userId,
        kind: r.kind,
        title: r.title,
        body: r.body ?? null,
        link: r.link ?? null,
        // Provenance and destination (migration 0021). ONE rule, in
        // @quagga/core: `undefined` means "the caller did not say" and defaults
        // to this app; an EXPLICIT null means "belongs to no single app" and
        // must survive, which is what the bulletin fan-out relies on.
        origin: r.origin ?? null,
        linkApp: resolveNotificationLinkApp(r.linkApp, "web"),
        bulletinId: r.bulletinId ?? null,
      })),
    );
  }
}

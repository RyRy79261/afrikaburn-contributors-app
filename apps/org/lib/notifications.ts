import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  groupNotificationsByDay,
  notificationLinkIsLocal,
  type DayGroup,
  type NotificationRow,
} from "@quagga/core";
import type { NotificationFilter, NotificationKind } from "@quagga/types";

import { getDb, schema, type DbHandle } from "./db";
import { isDatabaseConfigured } from "./config";
import { resolveOrgSession } from "./session";

// Notifications backend for the Organiser Console (docs/notifications-spec.md).
// Console staff have inboxes too (org-internal bulletins, org-targeted events).
// Reads are scoped to a `users.id` the caller resolved through the console gate;
// the header count falls back to resolving the session itself.

/**
 * Unread count for the console header bell. Pass the gated `dbUserId` (the
 * header already holds the session); falls back to resolving the session.
 * Env-less / not-ok → 0.
 */
export async function getUnreadNotificationCount(
  userId?: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  let uid = userId;
  if (!uid) {
    const session = await resolveOrgSession();
    if (session.kind !== "ok") return 0;
    uid = session.dbUserId;
  }
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, uid),
        isNull(schema.notifications.readAt),
      ),
    );
  return row?.count ?? 0;
}

/** One inbox row as the console /notifications surface consumes it. */
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

function toView(r: typeof schema.notifications.$inferSelect): NotificationView {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    // A link minted for ANOTHER app is a path this one cannot serve —
    // render the row unlinked rather than as a guaranteed 404. Null
    // linkApp (every pre-migration row) counts as local.
    link: notificationLinkIsLocal(r.linkApp, "org") ? r.link : null,
    bulletinId: r.bulletinId,
    createdAt: r.createdAt,
    readAt: r.readAt,
  };
}

/** The staff member's notifications, newest first, filtered + grouped by day. */
export async function listNotificationGroups(
  userId: string,
  filter: NotificationFilter = "all",
): Promise<DayGroup<NotificationView>[]> {
  if (!isDatabaseConfigured()) return [];
  const conds = [eq(schema.notifications.userId, userId)];
  if (filter === "unread") conds.push(isNull(schema.notifications.readAt));
  if (filter === "bulletins")
    conds.push(eq(schema.notifications.kind, "bulletin"));
  const rows = await getDb()
    .select()
    .from(schema.notifications)
    .where(and(...conds))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(200);
  return groupNotificationsByDay(rows.map(toView));
}

/** Latest ~n notifications flat (header dropdown panel). */
export async function recentNotifications(
  userId: string,
  limit = 6,
): Promise<NotificationView[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getDb()
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows.map(toView);
}

/** Rows per INSERT. Six parameters each, well inside Postgres' 65535 ceiling. */
const NOTIFICATION_INSERT_CHUNK = 1000;

/**
 * Insert notification rows (event-hook + bulletin-fan-out writer). Reuses a
 * db handle the caller already holds. No-op on an empty batch. Rows come from
 * the @quagga/core payload builders (never carry hard-locked private fields).
 */
export async function insertNotifications(
  handle: DbHandle,
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
        // Provenance and destination (migration 0021). A caller that knows
        // better overrides; otherwise the link belongs to THIS app, which is
        // what the bare relative path always implicitly assumed.
        origin: r.origin ?? null,
        linkApp: r.linkApp ?? "org",
        bulletinId: r.bulletinId ?? null,
      })),
    );
  }
}

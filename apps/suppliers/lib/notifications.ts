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

import { getDb, schema } from "./db";
import { isDatabaseConfigured } from "./config";

// Notifications backend for the Supplier Portal (docs/notifications-spec.md).
// Suppliers only ever get THEIR OWN supplier events (standing value changes +
// org-confirmed onboarding steps — never org-internal notes). Reads are scoped
// to the `users.id` the caller resolved through the portal gate (session.dbUserId).

/** Unread count for the portal header bell. Pass the gated `dbUserId`. */
export async function getUnreadNotificationCount(
  userId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ),
    );
  return row?.count ?? 0;
}

/** One inbox row as the portal /notifications surface consumes it. */
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
    link: notificationLinkIsLocal(r.linkApp, "suppliers") ? r.link : null,
    bulletinId: r.bulletinId,
    createdAt: r.createdAt,
    readAt: r.readAt,
  };
}

/** The supplier's notifications, newest first, filtered + grouped by day. */
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

/** Latest ~n notifications flat (the header dropdown panel). */
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

/** Rows per INSERT. Eight bound columns each, so Postgres' 65535-parameter
 * ceiling lands at 8191 rows — 1000 keeps a wide margin. */
const NOTIFICATION_INSERT_CHUNK = 1000;

/**
 * Insert notification rows (the org-side supplier hooks write here). Reuses a
 * db handle the caller already holds. No-op on an empty batch.
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
        linkApp: resolveNotificationLinkApp(r.linkApp, "suppliers"),
        bulletinId: r.bulletinId ?? null,
      })),
    );
  }
}

/** A published bulletin, as a supplier may read it. */
export interface SupplierBulletin {
  id: string;
  title: string;
  bodyMd: string;
  pinned: boolean;
  publishedAt: Date | null;
}

/**
 * One bulletin, IF this supplier was in its audience.
 *
 * Authorisation is the notification row, exactly as apps/web does it: the
 * bulletin is readable only when a `notifications` row ties it to this user, so
 * an org-internal or participant-targeted broadcast 404s here rather than
 * leaking. Unpublished bulletins are never returned.
 *
 * Added 27 Jul 2026 (audit B3): supplier bulletin notifications have always
 * linked to `/bulletins/<id>`, a route this app did not have — so every bulletin
 * in the supplier inbox was a 404 and the Bulletins tab was a dead end.
 */
export async function getBulletinForSupplier(
  userId: string,
  bulletinId: string,
): Promise<SupplierBulletin | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getDb();

  const [received] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.bulletinId, bulletinId),
      ),
    )
    .limit(1);
  if (!received) return null;

  const [bulletin] = await db
    .select({
      id: schema.bulletins.id,
      title: schema.bulletins.title,
      bodyMd: schema.bulletins.bodyMd,
      pinned: schema.bulletins.pinned,
      publishedAt: schema.bulletins.publishedAt,
    })
    .from(schema.bulletins)
    .where(eq(schema.bulletins.id, bulletinId))
    .limit(1);
  if (!bulletin || bulletin.publishedAt === null) return null;
  return bulletin;
}

"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession, resolveOrgSession } from "@/lib/session";
import { recentNotifications } from "@/lib/notifications";
import {
  NOTIFICATION_SOURCE_LABELS,
  timeAgo,
} from "@/components/notifications/relative-time";
import type { NotificationRowProps } from "@/components/notifications/notification-row";
import { runAction, type ActionResult } from "./result";

// Feeds the header notification panel (canvas `UAc97`) with the latest few rows,
// projected server-side into the display strings the client row renders. Takes
// NO input — the inbox is always the gated staff member's own (resolved here);
// a signed-out / env-less caller gets an empty list so the panel degrades to an
// empty state rather than erroring the chrome.
export async function fetchRecentNotifications(): Promise<
  Omit<NotificationRowProps, "onOpen">[]
> {
  const session = await resolveOrgSession();
  if (session.kind !== "ok") return [];
  const rows = await recentNotifications(session.dbUserId, 6);
  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    timeAgo: timeAgo(row.createdAt, now),
    source: NOTIFICATION_SOURCE_LABELS[row.kind],
    read: row.readAt !== null,
  }));
}

// Console notification mutations. Server-side authz: staff mark only their OWN
// rows read — the WHERE always pins user_id to the gated session's dbUserId.

const MarkReadInput = z.object({ notificationId: z.string().uuid() });

/** Mark a single notification read (own rows only). */
export async function markNotificationRead(
  raw: z.input<typeof MarkReadInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    // Own inbox only — every rank manages their own notifications.
    const session = await requireOrgSession();
    const input = MarkReadInput.parse(raw);
    await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.id, input.notificationId),
          eq(schema.notifications.userId, session.dbUserId),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  });
}

/** Mark every unread notification read (own inbox only). */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  return runAction(async () => {
    // Own inbox only — every rank manages their own notifications.
    const session = await requireOrgSession();
    await getDb()
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, session.dbUserId),
          isNull(schema.notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  });
}

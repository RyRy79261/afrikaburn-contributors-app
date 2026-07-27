"use server";

import { recentNotifications } from "@/lib/notifications";
import {
  toRowItem,
  type NotificationRowItem,
} from "@/components/notifications/format";

// Server action feeding the header notification panel. It takes NO input — the
// inbox it reads is always the authenticated user's (lib/notifications.ts scopes
// every query to the session), so there is no id to validate and no way to ask
// for someone else's rows. Signed-out / env-less callers get an empty list.

/** The latest ~6 notifications, projected for display. */
export async function fetchRecentNotifications(): Promise<
  NotificationRowItem[]
> {
  const rows = await recentNotifications(6);
  const now = new Date();
  return rows.map((row) => toRowItem(row, now));
}

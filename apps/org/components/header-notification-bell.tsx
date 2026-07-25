"use client";

import { NotificationPanel } from "./notifications/notification-panel";

/**
 * Header bell for the signed-in console chrome. Opening it shows the notification
 * panel — the last few items, "Mark all read", and a link through to
 * /notifications — anchored under the bell as a non-modal Popover (no page
 * overlay). Rendered only inside the console header; the gate has no chrome.
 */
export function HeaderNotificationBell({ count }: { count?: number }) {
  return <NotificationPanel count={count} />;
}

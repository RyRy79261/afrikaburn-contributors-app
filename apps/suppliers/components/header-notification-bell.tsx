"use client";

import { NotificationPanel } from "./notifications/notification-panel";

/**
 * Supplier-portal header bell (canvas header slot). `count` is the real unread
 * total, resolved server-side in `PortalHeader` and scoped to the gated
 * supplier's own rows. Opening it shows the notification panel — the last few
 * items, "Mark all read", and a link through to /notifications — anchored under
 * the bell as a non-modal Popover (no page overlay).
 */
export function HeaderNotificationBell({ count = 0 }: { count?: number }) {
  return <NotificationPanel count={count} />;
}

"use client";

import { NotificationPanel } from "./notifications/notification-panel";

/**
 * Header bell for the signed-in chrome. The bell itself is @quagga/ui's
 * stateless NotificationBell (badge from `count`); opening it shows the
 * notification panel — the last few items, "Mark all read", and a link through
 * to /notifications (docs/notifications-spec.md §Surfaces, canvas `UAc97`).
 * Rendered only for signed-in users — signed-out chrome (landing, auth) omits
 * it per the design canvas.
 */
export function HeaderNotificationBell({ count }: { count?: number }) {
  return <NotificationPanel count={count} />;
}

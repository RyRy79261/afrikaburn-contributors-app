"use client";

import { useRouter } from "next/navigation";
import { NotificationBell } from "@quagga/ui/components/notification-bell";

/**
 * Supplier-portal header bell (canvas header slot). `count` is the real unread
 * total, resolved server-side in `PortalHeader` and scoped to the gated
 * supplier's own rows; clicking opens the inbox at /notifications.
 *
 * No dropdown panel here on purpose: the portal has exactly one destination for
 * notifications, and the canvas shows the bell as a plain link to it.
 */
export function HeaderNotificationBell({ count = 0 }: { count?: number }) {
  const router = useRouter();
  return (
    <NotificationBell
      count={count}
      onClick={() => router.push("/notifications")}
    />
  );
}

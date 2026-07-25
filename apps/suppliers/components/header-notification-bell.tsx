"use client";

import { NotificationBell } from "@quagga/ui/components/notification-bell";
import { toast } from "@quagga/ui/components/toast";

/**
 * Supplier-portal header bell — the NotificationBell seam for this wave.
 *
 * Wraps the stateless @quagga/ui NotificationBell (canvas header slot) with a
 * placeholder count of 0: there is no supplier notifications surface yet, so the
 * bell renders with no badge and its click is a stub. When supplier
 * notifications land, swap the placeholder `count` for a real unread total and
 * point `onClick` at the notifications route — the chrome slot is already here.
 */
export function HeaderNotificationBell({ count = 0 }: { count?: number }) {
  return (
    <NotificationBell
      count={count}
      onClick={() =>
        toast("Notifications are coming soon.", {
          description: "You'll be told here when AfrikaBurn needs something.",
        })
      }
    />
  );
}

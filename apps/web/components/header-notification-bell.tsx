"use client";

import { useRouter } from "next/navigation";
import { NotificationBell } from "@quagga/ui/components/notification-bell";

/**
 * Header bell for the signed-in chrome. Wraps the stateless @quagga/ui
 * NotificationBell (which renders the badge from `count`) with the client-side
 * navigation to the notifications surface. Rendered only for signed-in users —
 * signed-out chrome (landing, auth) omits it per the design canvas.
 */
export function HeaderNotificationBell({ count }: { count?: number }) {
  const router = useRouter();
  return (
    <NotificationBell
      count={count}
      onClick={() => router.push("/notifications")}
    />
  );
}

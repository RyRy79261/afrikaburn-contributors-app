"use client";

import { useRouter } from "next/navigation";
import { NotificationBell } from "@quagga/ui/components/notification-bell";

/**
 * Header bell for the signed-in console chrome. Wraps the stateless @quagga/ui
 * NotificationBell (which renders the badge from `count`) with client-side
 * navigation to the notifications surface. Rendered only inside the console
 * header — the gate has no chrome. Same seam idiom as apps/web.
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

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { NotificationKind } from "@quagga/types";
import { NotificationItem } from "@quagga/ui/components/notification-item";

import { markNotificationRead } from "@/lib/actions/notifications";

// One inbox row. Opening it marks it read (server action — the WHERE pins the
// row to the signed-in staff member, so a row can only ever be read by its own
// recipient) and then follows the notification's in-app link when it has one.

export interface NotificationRowProps {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  timeAgo: string;
  source: string;
  read: boolean;
  /** Fired when the row is opened — e.g. so the header panel can close. */
  onOpen?: () => void;
}

export function NotificationRow({
  id,
  kind,
  title,
  body,
  link,
  timeAgo,
  source,
  read,
  onOpen,
}: NotificationRowProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function open() {
    onOpen?.();
    startTransition(async () => {
      if (!read) await markNotificationRead({ notificationId: id });
      if (link) router.push(link);
      else router.refresh();
    });
  }

  return (
    <li className="border-b border-border last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        aria-busy={pending || undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className="cursor-pointer rounded-md transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <NotificationItem
          kind={kind}
          title={title}
          meta={
            body ? (
              <span className="flex flex-col gap-0.5">
                <span>{body}</span>
                <span>
                  {timeAgo} · {source}
                </span>
              </span>
            ) : undefined
          }
          timeAgo={timeAgo}
          source={source}
          read={read}
        />
      </div>
    </li>
  );
}

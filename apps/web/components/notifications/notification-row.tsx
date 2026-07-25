"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NotificationItem } from "@quagga/ui/components/notification-item";
import { markNotificationRead } from "@/lib/notifications-actions";
import type { NotificationRowItem } from "./format";

// One interactive inbox row. The presentation is entirely @quagga/ui's
// NotificationItem (canvas `H9bn7`/`IDy9A`); this wrapper only adds the
// behaviour the canvas implies: opening a row marks it read and follows its
// link. Marking read is a server action whose WHERE pins user_id to the
// authenticated user — a row that isn't yours simply no-ops (server-side authz;
// nothing here is a security boundary).

export function NotificationRow({
  item,
  className,
  onOpen,
}: {
  item: NotificationRowItem;
  className?: string;
  /** Fired when the row is opened — e.g. so the header panel can close. */
  onOpen?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Optimistic: the dot clears the moment you open the row. Derived (not
  // seeded) state so a server refresh — e.g. after "Mark all read" — still wins.
  const [opened, setOpened] = React.useState(false);
  const read = item.read || opened;

  const row = (
    <NotificationItem
      kind={item.kind}
      title={item.title}
      meta={item.meta}
      read={read}
      blocking={item.blocking}
      className={className}
    />
  );

  // Nothing to do: already read and nowhere to go → a plain, inert row.
  if (read && !item.link) return row;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setOpened(true);
        onOpen?.();
        startTransition(async () => {
          if (!item.read) await markNotificationRead({ notificationId: item.id });
          if (item.link) router.push(item.link);
          else router.refresh();
        });
      }}
      className="block w-full rounded-lg text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-70"
    >
      {row}
    </button>
  );
}

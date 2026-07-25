"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NotificationBell } from "@quagga/ui/components/notification-bell";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@quagga/ui/components/popover";

import { fetchRecentNotifications } from "@/lib/actions/notifications";
import type { NotificationRowItem } from "./format";
import { NotificationRow } from "./notification-row";
import { MarkAllReadButton } from "./mark-all-read-button";

// Portal header notification panel (canvas `UAc97`): the bell opens a non-modal
// Popover with the last ~6 rows, "Mark all read", and "All notifications →".
// Popover renders no page overlay, so the portal behind stays undimmed while
// Radix still gives focus management + Escape / outside-click dismissal.
//
// Items load lazily on open via a server action scoped to the gated supplier's
// own inbox; the badge count still comes from the server render (PortalHeader)
// so it is correct before any interaction.

const PANEL_CLASS =
  "flex w-[min(26rem,calc(100vw-1rem))] flex-col gap-0 overflow-hidden p-0";

export function NotificationPanel({ count = 0 }: { count?: number }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationRowItem[] | null>(null);
  // Bumped to force a refetch (e.g. after "Mark all read").
  const [nonce, setNonce] = React.useState(0);
  const headingId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchRecentNotifications().then((rows) => {
      if (!cancelled) setItems(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, nonce]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <NotificationBell count={count} />
      </PopoverTrigger>
      <PopoverContent
        className={PANEL_CLASS}
        align="end"
        sideOffset={8}
        aria-labelledby={headingId}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 id={headingId} className="text-sm font-semibold">
            Notifications
          </h2>
          <MarkAllReadButton
            unreadCount={count}
            className="-mr-2"
            onDone={() => setNonce((n) => n + 1)}
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {items === null ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              You&apos;re all caught up — step confirmations, standing changes
              and depot bulletins will land in this panel.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    className="px-3 py-3"
                    onOpen={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-2.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            All notifications
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NotificationBell } from "@quagga/ui/components/notification-bell";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { fetchRecentNotifications } from "@/app/notifications/actions";
import type { NotificationRowItem } from "./format";
import { NotificationRow } from "./notification-row";
import { MarkAllReadButton } from "./mark-all-read-button";

// The header notification panel (canvas `UAc97`): the bell opens a card with the
// last ~6 items, "Mark all read", and "All notifications →".
//
// @quagga/ui has no popover primitive and this slice may not add dependencies,
// so the panel is anchored with the Dialog primitive that @quagga/ui already
// ships (Radix Dialog — real focus management, Escape/outside-click dismissal)
// rather than a hand-rolled dropdown. It is positioned top-right under the
// header on desktop and near-full-width on mobile.
//
// Items load lazily on open via a server action, so the panel costs nothing on
// pages nobody opens it from, and the unread count still comes from the server
// render (AppShell) so the badge is correct before any interaction.

const PANEL_CLASS = [
  "top-14 right-2 bottom-auto left-auto translate-x-0 translate-y-0",
  "flex w-[min(26rem,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0",
  "sm:top-16 sm:right-4 sm:max-w-none",
].join(" ");

export function NotificationPanel({ count = 0 }: { count?: number }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationRowItem[] | null>(null);
  // Bumped to force a refetch (e.g. after "Mark all read").
  const [nonce, setNonce] = React.useState(0);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <NotificationBell count={count} />
      </DialogTrigger>
      <DialogContent className={PANEL_CLASS} showCloseButton={false}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <DialogTitle className="text-sm font-semibold">
            Notifications
          </DialogTitle>
          <DialogDescription className="sr-only">
            Your most recent notifications from AfrikaBurn and your camps.
          </DialogDescription>
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
              Nothing here yet — camp events and AfrikaBurn bulletins will land
              in this panel.
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
          <DialogClose asChild>
            <Link
              href="/notifications"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              All notifications
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

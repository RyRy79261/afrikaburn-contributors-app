import type { ReactNode } from "react";
import { BellOff, Inbox, Megaphone } from "lucide-react";
import { NotificationFilter } from "@quagga/types";
import { EmptyState } from "@quagga/ui/components/empty-state";

import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  getUnreadNotificationCount,
  listNotificationGroups,
} from "@/lib/notifications";
import { NotificationFilterTabs } from "@/components/notifications/filter-tabs";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { NotificationRow } from "@/components/notifications/notification-row";
import { dayGroupHeading, toRowItem } from "@/components/notifications/format";

// /notifications — the supplier inbox (canvas `swSq4` desktop / `OSqoc`
// mobile), sage accent.
//
// WHAT A SUPPLIER SEES, and nothing else (docs/supplier-spec.md +
// docs/notifications-spec.md):
//   · org confirmations of their own onboarding steps (deposit received,
//     briefing attended, registration fee received…);
//   · changes to their own STANDING — the VALUE only. The org's notes timeline
//     (infractions/blessings/notes) is org-internal and never leaves the
//     console; the standing hook in apps/org writes the label alone;
//   · AfrikaBurn bulletins broadcast to suppliers.
//
// Every read is scoped inside lib/notifications.ts to the `users.id` this page
// resolved through the portal gate — the page never takes a user id from the
// request.

export const dynamic = "force-dynamic";

const EMPTY_COPY: Record<
  NotificationFilter,
  { title: string; description: string; icon: ReactNode }
> = {
  all: {
    title: "You're all caught up",
    description:
      "New deposit confirmations, briefing sign-offs, standing changes and depot bulletins will appear here.",
    icon: <Inbox className="h-6 w-6" aria-hidden />,
  },
  unread: {
    title: "Nothing unread",
    description: "Every notification in your inbox has been read.",
    icon: <BellOff className="h-6 w-6" aria-hidden />,
  },
  bulletins: {
    title: "No bulletins yet",
    description:
      "Broadcasts from AfrikaBurn — delivery windows, depot notices and deadlines — show up here.",
    icon: <Megaphone className="h-6 w-6" aria-hidden />,
  },
};

export default async function SupplierNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const { filter: rawFilter } = await searchParams;
  // Unknown query values fall back to "all" rather than erroring the page.
  const filter = NotificationFilter.catch("all").parse(rawFilter ?? "all");

  const [groups, unread] = await Promise.all([
    listNotificationGroups(session.dbUserId, filter),
    getUnreadNotificationCount(session.dbUserId),
  ]);

  const now = new Date();
  const rowGroups = groups.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items.map((item) => toRowItem(item, now)),
  }));
  const empty = EMPTY_COPY[filter];

  return (
    <div>
      <PageHeading
        eyebrow="Supplier Portal"
        title="Notifications"
        description="Step confirmations, standing changes and depot bulletins from AfrikaBurn — all in one place."
        actions={<MarkAllReadButton unreadCount={unread} />}
      />

      <div className="mb-6">
        <NotificationFilterTabs filter={filter} unreadCount={unread} />
      </div>

      {rowGroups.length === 0 ? (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
        />
      ) : (
        <div className="flex flex-col gap-7">
          {rowGroups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {dayGroupHeading(group.label)}
              </h2>
              <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border bg-card/40">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NotificationRow item={item} className="px-4 py-3.5" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

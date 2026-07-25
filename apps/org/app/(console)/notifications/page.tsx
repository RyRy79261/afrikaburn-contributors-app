import Link from "next/link";
import { Inbox } from "lucide-react";
import { Card, CardContent } from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { cn } from "@quagga/ui/lib/utils";
import { NotificationFilter } from "@quagga/types";

import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  getUnreadNotificationCount,
  listNotificationGroups,
} from "@/lib/notifications";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { NotificationRow } from "@/components/notifications/notification-row";
import {
  NOTIFICATION_SOURCE_LABELS,
  timeAgo,
} from "@/components/notifications/relative-time";

// Org /notifications (canvas `xRjgy` · mobile `Cb5MV`) — the same one-inbox
// pattern as the participant app in console clothes (apricot accent): filter
// tabs, day groups, mark-all-read. Personal events + org bulletins, one stream,
// always scoped to the signed-in staff member's own rows.

export const dynamic = "force-dynamic";

const TABS: { value: NotificationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "bulletins", label: "Bulletins" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { filter: rawFilter } = await searchParams;
  // Unknown query values fall back to "all" rather than erroring the page.
  const filter = NotificationFilter.catch("all").parse(rawFilter ?? "all");

  const [groups, unread] = await Promise.all([
    listNotificationGroups(guard.session.dbUserId, filter),
    getUnreadNotificationCount(guard.session.dbUserId),
  ]);
  const now = new Date();
  const isEmpty = groups.length === 0;

  return (
    <div>
      <PageHeading
        eyebrow="Console"
        title="Notifications"
        description="Personal events and broadcasts — one inbox."
        actions={<MarkAllReadButton disabled={unread === 0} />}
      />

      <nav
        className="mb-6 flex flex-wrap items-center gap-2"
        aria-label="Filter notifications"
      >
        {TABS.map((tab) => {
          const active = tab.value === filter;
          return (
            <Link
              key={tab.value}
              href={
                tab.value === "all"
                  ? "/notifications"
                  : `/notifications?filter=${tab.value}`
              }
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.value === "unread" && unread > 0
                ? `${tab.label} · ${unread}`
                : tab.label}
            </Link>
          );
        })}
      </nav>

      {isEmpty ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" aria-hidden />}
          title={
            filter === "unread"
              ? "Nothing unread"
              : filter === "bulletins"
                ? "No bulletins in your inbox"
                : "Your inbox is empty"
          }
          description="Registration decisions, officer acceptances, questionnaire releases and org bulletins land here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {group.label}
              </h2>
              <Card>
                <CardContent className="p-1">
                  <ul className="flex flex-col">
                    {group.items.map((item) => (
                      <NotificationRow
                        key={item.id}
                        id={item.id}
                        kind={item.kind}
                        title={item.title}
                        body={item.body}
                        link={item.link}
                        timeAgo={timeAgo(item.createdAt, now)}
                        source={NOTIFICATION_SOURCE_LABELS[item.kind]}
                        read={item.readAt !== null}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

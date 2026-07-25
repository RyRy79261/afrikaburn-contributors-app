import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BellOff, Megaphone, Inbox } from "lucide-react";
import { NotificationFilter } from "@quagga/types";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser, enforceGate } from "@/lib/session";
import {
  getUnreadNotificationCount,
  listNotificationGroups,
} from "@/lib/notifications";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { NotificationFilterTabs } from "@/components/notifications/filter-tabs";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { NotificationDayGroups } from "@/components/notifications/notification-day-groups";
import { toRowItem } from "@/components/notifications/format";

// /notifications — the participant inbox (canvas `X6YN3` desktop / `qLjMS`
// mobile). One stream, two origins: personal event notifications and org
// bulletin broadcasts (docs/notifications-spec.md). Every read is scoped to the
// signed-in user inside lib/notifications.ts — this page never takes a user id
// from the request.

export const dynamic = "force-dynamic";

const EMPTY_COPY: Record<
  NotificationFilter,
  { title: string; description: string; icon: ReactNode }
> = {
  all: {
    title: "Nothing here yet",
    description:
      "Camp events, questionnaires, and AfrikaBurn bulletins will land here as they happen.",
    icon: <Inbox className="h-6 w-6" aria-hidden />,
  },
  unread: {
    title: "You're all caught up",
    description: "Every notification in your inbox has been read.",
    icon: <BellOff className="h-6 w-6" aria-hidden />,
  },
  bulletins: {
    title: "No bulletins yet",
    description:
      "Broadcasts from AfrikaBurn — deadlines, notices, and reminders — show up here.",
    icon: <Megaphone className="h-6 w-6" aria-hidden />,
  },
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Notifications" />
      </AppShell>
    );
  }

  const user = await requireCampUser();
  // The app-wide hard gate: a pending blocking action outranks the inbox.
  await enforceGate(user.id);

  // Zod at the boundary — an unknown ?filter= falls back to "all" rather than
  // throwing (a shared link with a stale param should still open the inbox).
  const { filter: rawFilter } = await searchParams;
  const parsed = NotificationFilter.safeParse(rawFilter);
  const filter: NotificationFilter = parsed.success ? parsed.data : "all";

  const [unreadCount, groups] = await Promise.all([
    getUnreadNotificationCount(),
    listNotificationGroups(filter),
  ]);

  const now = new Date();
  const rowGroups = groups.map((group) => ({
    ...group,
    items: group.items.map((item) => toRowItem(item, now)),
  }));

  const empty = EMPTY_COPY[filter];

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            Your inbox
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Notifications
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Camp events, questionnaires, and AfrikaBurn bulletins — all in one
            place. This is the source of truth; email is just a nudge.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <NotificationFilterTabs filter={filter} unreadCount={unreadCount} />
          <MarkAllReadButton unreadCount={unreadCount} />
        </div>

        {rowGroups.length === 0 ? (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
          />
        ) : (
          <NotificationDayGroups groups={rowGroups} />
        )}
      </div>
    </AppShell>
  );
}

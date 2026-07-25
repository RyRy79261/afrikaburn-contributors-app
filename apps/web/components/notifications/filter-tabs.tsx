import Link from "next/link";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@quagga/ui/components/tabs";
import type { NotificationFilter } from "@quagga/types";

// The All / Unread · n / Bulletins segmented control (canvas `X6YN3` toolbar).
// State lives in the URL (`?filter=`) so the list stays a server render and a
// filtered inbox is linkable/back-button-friendly — each trigger is therefore a
// <Link> (Radix `asChild`), not a client tab handler. The empty TabsContent
// panels exist so every trigger's aria-controls resolves.

const TAB_ORDER: readonly NotificationFilter[] = ["all", "unread", "bulletins"];

const TAB_LABEL: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
  bulletins: "Bulletins",
};

/** `/notifications` for the default tab, `?filter=x` otherwise. */
export function notificationsHref(filter: NotificationFilter): string {
  return filter === "all" ? "/notifications" : `/notifications?filter=${filter}`;
}

export function NotificationFilterTabs({
  filter,
  unreadCount,
}: {
  filter: NotificationFilter;
  unreadCount: number;
}) {
  return (
    <Tabs value={filter}>
      <TabsList>
        {TAB_ORDER.map((tab) => (
          <TabsTrigger key={tab} value={tab} asChild>
            <Link href={notificationsHref(tab)} scroll={false}>
              {TAB_LABEL[tab]}
              {tab === "unread" && unreadCount > 0 ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  · {unreadCount}
                </span>
              ) : null}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
      {TAB_ORDER.map((tab) => (
        <TabsContent key={tab} value={tab} className="m-0" />
      ))}
    </Tabs>
  );
}

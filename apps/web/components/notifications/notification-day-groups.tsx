import type { DayGroup } from "@quagga/core";
import { dayGroupHeading, type NotificationRowItem } from "./format";
import { NotificationRow } from "./notification-row";

// The day-grouped inbox list (canvas `X6YN3` / `qLjMS`): a small uppercase day
// heading ("TODAY", "YESTERDAY", "MON 20 JUL") over its rows. Grouping itself is
// @quagga/core's `groupNotificationsByDay` — this is presentation only.

export function NotificationDayGroups({
  groups,
}: {
  groups: DayGroup<NotificationRowItem>[];
}) {
  return (
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
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
  );
}

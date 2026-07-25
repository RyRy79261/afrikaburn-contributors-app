import { Card, CardContent } from "@quagga/ui/components/card";
import {
  activityLabel,
  activityTone,
  relativeTime,
  type ActivityTone,
} from "@/lib/status-board-format";
import type { ActivityRow } from "@/lib/status-board";

// The audit-event activity feed. Rows are real `audit_events` — actor, what
// they did, when. There is no audit-log page yet, so there is no "view all"
// link here; when one ships this card gains it.

const TONE_DOT: Record<ActivityTone, string> = {
  approve: "bg-ab-sage",
  attention: "bg-ab-apricot",
  reject: "bg-destructive",
  neutral: "bg-muted-foreground",
};

/** Actor display: the local part of the staff email, or "Staff". */
function actorName(email: string | null): string {
  if (!email) return "Staff";
  return email.split("@")[0] ?? email;
}

export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">Recent activity</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has happened in the console yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[activityTone(row.action)]}`}
                    aria-hidden
                  />
                  <span className="truncate">
                    <span className="font-medium">{actorName(row.actorEmail)}</span>{" "}
                    <span className="text-muted-foreground">
                      {activityLabel(row.action)}
                    </span>
                  </span>
                </span>
                <time
                  dateTime={row.createdAt.toISOString()}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {relativeTime(row.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

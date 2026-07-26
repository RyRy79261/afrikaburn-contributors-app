import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { ScrollText } from "lucide-react";

import type { AuditTrailRow } from "@/lib/medical-audit";
import { formatDateTime } from "@/lib/labels";
import {
  activityLabel,
  activityTone,
  type ActivityTone,
} from "@/lib/status-board-format";

// The full console trail. The Overview's six-row card is a glance; this is the
// record — every audit action, including the medical reads the glance keeps out
// so decisions stay visible there.

const TONE_DOT: Record<ActivityTone, string> = {
  approve: "bg-ab-sage",
  attention: "bg-ab-apricot",
  reject: "bg-destructive",
  neutral: "bg-muted-foreground",
};

function actorName(email: string | null): string {
  if (!email) return "Staff";
  return email.split("@")[0] ?? email;
}

export function AuditTrailList({ rows }: { rows: AuditTrailRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4 text-accent" aria-hidden />
          All console activity
        </CardTitle>
        <CardDescription>
          Every audit event, newest first — decisions, admin changes and medical
          reads together.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                    <span className="font-medium">
                      {actorName(row.actorEmail)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {activityLabel(row.action)}
                    </span>
                  </span>
                </span>
                <time
                  dateTime={row.createdAt.toISOString()}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {formatDateTime(row.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { ChevronRight, Lock, ShieldAlert } from "lucide-react";
import {
  MESSAGE_REPORT_STATUSES,
  REPORT_COPY_RETENTION_DAYS,
  orgCapabilityRefusal,
  type MessageReportStatus,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";

import { guardConsole } from "@/lib/gate";
import { listMessageReports } from "@/lib/message-reports";
import { PageHeading } from "@/components/page-heading";

// /safety — the direct-message report queue (epic #69). NEEDS DESIGN REVIEW.
//
// Shows WHO reported WHOM and WHEN — no message and no reason text is loaded
// for this list. The reported messages render only on a report's own page,
// and opening one is audited. There is no path from here (or anywhere in the
// console) to a conversation: the org sees what a participant reported and
// nothing else.

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

export default async function SafetyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { actor } = guard.session;

  const requested = (await searchParams).status;
  const status: MessageReportStatus =
    MESSAGE_REPORT_STATUSES.find((s) => s === requested) ?? "open";

  const reports = await listMessageReports(actor, status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Console / Safety"
        title="Message reports"
        description={`Messages burners reported from their private chats. You see only the messages they chose to report — never the conversation. Report copies are deleted ${REPORT_COPY_RETENTION_DAYS} days after the report.`}
      />

      {reports === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
              Message reports
            </CardTitle>
            <CardDescription>
              {orgCapabilityRefusal(
                actor,
                "personal_information",
                "registrations",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Reported messages are private words between burners. Only the safety
            team — the people who may read medical notes — can open them.
          </CardContent>
        </Card>
      ) : (
        <>
          <nav aria-label="Report status" className="flex gap-2">
            {MESSAGE_REPORT_STATUSES.map((s) => (
              <Link
                key={s}
                href={`/safety?status=${s}`}
                aria-current={s === status ? "page" : undefined}
                className={
                  s === status
                    ? "rounded-md bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary"
                }
              >
                {s === "open" ? "Open" : "Resolved"}
              </Link>
            ))}
          </nav>
          {reports.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-6 w-6" aria-hidden />}
              title={
                status === "open" ? "No open reports" : "Nothing resolved yet"
              }
              description="When a burner reports messages from a chat, it lands here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/safety/${r.id}`}
                    className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{r.reporterName}</span>{" "}
                      reported{" "}
                      <span className="font-medium">{r.reportedName}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">
                        {r.messageCount}{" "}
                        {r.messageCount === 1 ? "message" : "messages"}
                      </Badge>
                      {DATE.format(r.createdAt)}
                      <ChevronRight
                        className="ml-auto h-4 w-4 sm:ml-0"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

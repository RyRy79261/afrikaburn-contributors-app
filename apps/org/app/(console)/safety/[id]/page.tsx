import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { canResolveMessageReports } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";

import { guardConsole } from "@/lib/gate";
import { getMessageReport } from "@/lib/message-reports";
import { PageHeading } from "@/components/page-heading";
import { ResolveReportButton } from "@/components/safety/resolve-report-button";

// /safety/[id] — one direct-message report (epic #69). NEEDS DESIGN REVIEW.
//
// Renders the COPIES of exactly the messages the reporter selected, and
// nothing from the conversation around them — `getMessageReport` never reads
// the live `messages` table. Opening this page writes a `dm.report.view`
// audit row. A refused viewer gets the same not-found as an unknown id.

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

const DATE = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

export default async function SafetyReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const report = await getMessageReport(
    guard.session.actor,
    guard.session.dbUserId,
    parsed.data.id,
  );
  if (!report) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/safety">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Message reports
        </Link>
      </Button>
      <PageHeading
        eyebrow="Console / Safety"
        title={`${report.reporterName} reported ${report.reportedName}`}
        description={`Reported ${DATE.format(report.createdAt)}. This copy is deleted ${DATE.format(report.expiresAt)}. Opening this report is recorded in the audit log.`}
        actions={
          report.status === "open" &&
          canResolveMessageReports(guard.session.actor) ? (
            <ResolveReportButton reportId={report.id} />
          ) : (
            <Badge variant={report.status === "open" ? "default" : "secondary"}>
              {report.status === "open" ? "Open" : "Resolved"}
            </Badge>
          )
        }
      />

      {report.reason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the reporter said</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{report.reason}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reported messages</CardTitle>
          <CardDescription>
            Only the {report.messageCount}{" "}
            {report.messageCount === 1 ? "message" : "messages"} the reporter
            selected. The rest of the conversation is private and is not
            available to AfrikaBurn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {report.items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {item.senderName}
                  </span>
                  {item.fromReportedUser && " (reported)"} ·{" "}
                  {DATE.format(item.sentAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {item.kind === "system"
                    ? `${item.senderName} ${item.body}`
                    : item.body}
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

import { AlertTriangle, ShieldCheck, Stethoscope } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import type { MedicalAccessBasis, MedicalEnumerationAlert } from "@quagga/core";

import type { MedicalAccessLog, MedicalReadRow } from "@/lib/medical-audit";
import { formatDateTime } from "@/lib/labels";
import { relativeTime } from "@/lib/status-board-format";

// The medical-notes read trail, made READABLE.
//
// Every `bio.medical.view` row is a disclosure of someone's health information
// that already happened — the read path is fail-open by design, so nothing on
// this page could have stopped it. What this page does is make the abuse shape
// visible: one actor, many different burners, one short window. That is the
// whole compensating control for the missing rate limit, and it only works if a
// human can actually see it.

const BASIS_LABEL: Record<MedicalAccessBasis, string> = {
  self: "Own notes",
  org_staff: "Org staff",
  camp_lead: "Camp lead",
};

/** Actor display: the local part of the staff email, or a stable fallback. */
function actorName(email: string | null | undefined): string {
  if (!email) return "Unknown actor";
  return email.split("@")[0] ?? email;
}

function AlertBanner({
  alerts,
  actorEmails,
}: {
  alerts: readonly MedicalEnumerationAlert[];
  actorEmails: Record<string, string | null>;
}) {
  if (alerts.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ab-sage" aria-hidden />
        No enumeration pattern in this window. Nobody has read an unusual number
        of different burners&apos; notes in a short span.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {alerts.length === 1
          ? "One account looks like it enumerated medical notes"
          : `${alerts.length} accounts look like they enumerated medical notes`}
      </p>
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {alerts.map((alert) => (
          <li key={alert.actorId}>
            <span className="font-medium text-foreground">
              {actorName(actorEmails[alert.actorId])}
            </span>{" "}
            read <span className="font-medium text-foreground">
              {alert.subjectCount} different burners&apos;
            </span>{" "}
            notes ({alert.readCount} reads) between{" "}
            {formatDateTime(alert.windowStart)} and{" "}
            {formatDateTime(alert.windowEnd)}.
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Medical reads are never blocked — an emergency must not wait on a check.
        This is the compensating control: the pattern is recorded and surfaced so
        it can be asked about.
      </p>
    </div>
  );
}

function ReadRow({ row }: { row: MedicalReadRow }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-medium">
        {actorName(row.actorEmail)}
      </TableCell>
      <TableCell>{row.subjectName ?? "Unknown burner"}</TableCell>
      <TableCell>
        {row.basis ? (
          <Badge variant={row.basis === "camp_lead" ? "secondary" : "outline"}>
            {BASIS_LABEL[row.basis]}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={row.createdAt.toISOString()}>
          {formatDateTime(row.createdAt)}
        </time>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
        {relativeTime(row.createdAt)}
      </TableCell>
    </TableRow>
  );
}

export function MedicalAccessPanel({
  log,
  displayLimit = 50,
}: {
  log: MedicalAccessLog;
  displayLimit?: number;
}) {
  const { rows, summary, truncated, lookbackDays, actorEmails } = log;
  const shown = rows.slice(0, displayLimit);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-accent" aria-hidden />
          Medical-notes reads
        </CardTitle>
        <CardDescription>
          Every time someone opened a burner&apos;s medical notes in the last{" "}
          {lookbackDays} days. {summary.reads} read
          {summary.reads === 1 ? "" : "s"} by {summary.actors} account
          {summary.actors === 1 ? "" : "s"}, covering {summary.subjects} burner
          {summary.subjects === 1 ? "" : "s"}. Notes themselves are never shown
          here — only who looked, at whose, and when.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AlertBanner alerts={summary.alerts} actorEmails={actorEmails} />

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has opened a burner&apos;s medical notes in this window.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who looked</TableHead>
                  <TableHead>Whose notes</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Ago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <ReadRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
            {(rows.length > shown.length || truncated) && (
              <p className="text-xs text-muted-foreground">
                Showing the {shown.length} most recent of {rows.length} loaded
                {truncated
                  ? " — the window holds more than the console loads at once, so counts above cover the loaded rows only."
                  : "."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

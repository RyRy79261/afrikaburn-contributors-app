import { Stethoscope } from "lucide-react";
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import type { MedicalAccessBasis } from "@quagga/core";

import type { MedicalAccessLog, MedicalReadRow } from "@/lib/medical-audit";
import { formatDateTime } from "@/lib/labels";
import { relativeTime } from "@/lib/status-board-format";

// The medical-notes read trail, made READABLE.
//
// Every `bio.medical.view` row is a disclosure of someone's health information
// that already happened — the read path is fail-open by design, so nothing on
// this page could have stopped it, and nothing here tries to judge it.
//
// It is a RECORD: it answers "who saw my medical information?" when a burner
// asks, and lets a real incident be reconstructed. It deliberately does NOT
// aggregate by actor or flag volume. Working through every member of a camp
// before the burn is what the job looks like, so surfacing that as a pattern
// would report ordinary care as an incident and tell the people we most need
// reading this information that the tool is watching them. (Ryan, 26 Jul 2026 —
// an enumeration detector was built here and removed for exactly that reason;
// `lib/__tests__/medical-audit-surface.test.ts` pins its absence.)

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
  const { rows, truncated, lookbackDays } = log;
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
          {lookbackDays} days. Notes themselves are never shown here — only who
          looked, at whose, and when.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has opened a burner&apos;s medical notes in this window.
          </p>
        ) : (
          <>
            {/* NAMED. The audit page renders two tables and neither carried an
                accessible name, so a screen reader announced "table" twice with
                nothing to tell them apart — on the one page whose whole purpose
                is answering "who saw my medical information?". Visually hidden
                because the Card title already says it on screen. */}
            <Table>
              <TableCaption className="sr-only">
                Medical-notes reads: who looked, whose notes, and when
              </TableCaption>
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

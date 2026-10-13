"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { WapProjectSummary } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { WapListStatusBadge } from "./wap-badges";

// Every project's passes for the edition (frame W3, mobile T0yoB): a table
// from md up, cards on a phone. Counts only — no person is named here. Every
// project whose registration may ask is a row, asked or not.

const KIND_LABELS: Record<string, string> = {
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

function Pending({ ask }: { ask: number | null }) {
  if (ask === null) {
    // The dash fills the desktop column; a phone card has no pending line.
    return (
      <span
        className="hidden text-muted-foreground md:inline"
        aria-label="No pending request"
      >
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant="warning">{ask} asked</Badge>
      <span className="text-sm text-muted-foreground md:hidden">
        waiting for a decision
      </span>
    </span>
  );
}

export function WapOverviewTable({ rows }: { rows: WapProjectSummary[] }) {
  const columns = React.useMemo<ResponsiveColumn<WapProjectSummary>[]>(
    () => [
      {
        id: "project",
        header: "Project",
        role: "title",
        cell: (r) => (
          <span className="flex flex-col">
            <Link
              href={`/registrations/${r.registrationId}/passes`}
              className="font-medium hover:underline"
            >
              {r.projectName}
            </Link>
            {/* The type sits under the name on a phone card (frame T0yoB). */}
            <span className="text-sm font-normal text-muted-foreground md:hidden">
              {KIND_LABELS[r.groupKind] ?? r.groupKind}
            </span>
          </span>
        ),
      },
      {
        id: "type",
        header: "Type",
        mobileHidden: true,
        cell: (r) => (
          <span className="text-muted-foreground">
            {KIND_LABELS[r.groupKind] ?? r.groupKind}
          </span>
        ),
      },
      {
        id: "requested",
        header: "Requested",
        cell: (r) => <span className="tabular-nums">{r.requested}</span>,
      },
      {
        id: "granted",
        header: "Granted",
        // A number, 0 included: a project that never asked reads 0 / 0 / 0.
        cell: (r) => <span className="tabular-nums">{r.granted}</span>,
      },
      {
        id: "allocated",
        header: "Allocated",
        cell: (r) => (
          <span className="tabular-nums">
            {r.granted > 0 ? `${r.allocated} of ${r.granted}` : r.allocated}
          </span>
        ),
      },
      {
        id: "pending",
        header: "Pending",
        role: "detail",
        cell: (r) => <Pending ask={r.pendingAsk} />,
      },
      {
        id: "status",
        header: "List status",
        role: "badge",
        // A project that never asked has a `draft` list by default; it reads
        // "Not asked", not "Draft" (@quagga/core `wapOverviewStatus`).
        cell: (r) =>
          r.asked ? (
            <WapListStatusBadge status={r.listStatus} />
          ) : (
            <Badge variant="outline">Not asked</Badge>
          ),
      },
      {
        id: "open",
        header: "Open",
        hideHeader: true,
        // Beside the status chip on a phone card, last column at md+.
        role: "badge",
        align: "right",
        cell: (r) => (
          <Link
            href={`/registrations/${r.registrationId}/passes`}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
            <span className="sr-only">Open {r.projectName}&apos;s passes</span>
          </Link>
        ),
      },
    ],
    [],
  );

  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(r) => r.registrationId}
      caption="Work Access Passes by project"
      cardPairsLayout="grid"
      emptyState={
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No project matches these filters.
        </p>
      }
    />
  );
}

"use client";

import * as React from "react";
import { AlertTriangle, Pencil, Ticket } from "lucide-react";
import {
  wapDateLabel,
  wapFlagLabel,
  wapYesNo,
  type WapPassField,
  type WapPassFlag,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";

// The pass list as the org reviewer reads it (frame W2): a table from md up,
// the same rows as cards on a phone. Read-only — the org approves or returns
// the WHOLE list; it never edits a name. Dates and build/strike are the
// EFFECTIVE values (the lead's override, else the member's roster plan, else —
// arrival only — the registration's first arrival), with "edited" where the
// lead changed one. Flags never block approval.

export interface ReviewPassRow {
  allocationId: string;
  displayName: string;
  effective: {
    arrivalDate: string | null;
    departureDate: string | null;
    build: boolean | null;
    strike: boolean | null;
    edited: Record<WapPassField, boolean>;
  };
  flags: WapPassFlag[];
}

function Edited() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-accent">
      <Pencil className="h-3 w-3" aria-hidden />
      edited
    </span>
  );
}

function Value({ text, edited }: { text: string; edited: boolean }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
      <span>{text}</span>
      {edited && <Edited />}
    </span>
  );
}

function Flags({ flags }: { flags: readonly WapPassFlag[] }) {
  if (flags.length === 0) {
    return (
      <span className="text-muted-foreground" aria-label="No flags">
        —
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1.5">
      {flags.map((f) =>
        f.kind === "other_project" ? (
          <Badge
            key={`${f.kind}-${f.projectName}`}
            variant="outline"
            className="normal-case tracking-normal text-foreground"
          >
            <Ticket className="h-3 w-3" aria-hidden />
            {wapFlagLabel(f)}
          </Badge>
        ) : (
          <Badge
            key={f.kind}
            variant="warning"
            className="normal-case tracking-normal"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {wapFlagLabel(f)}
          </Badge>
        ),
      )}
    </span>
  );
}

export function ReviewPassList({ rows }: { rows: ReviewPassRow[] }) {
  const columns = React.useMemo<ResponsiveColumn<ReviewPassRow>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        role: "title",
        cell: (r) => <span className="font-medium">{r.displayName}</span>,
      },
      {
        id: "arrival",
        header: "Arrival",
        cell: (r) => (
          <Value
            text={wapDateLabel(r.effective.arrivalDate)}
            edited={r.effective.edited.arrivalDate}
          />
        ),
      },
      {
        id: "departure",
        header: "Departure",
        cell: (r) => (
          <Value
            text={wapDateLabel(r.effective.departureDate)}
            edited={r.effective.edited.departureDate}
          />
        ),
      },
      {
        id: "build",
        header: "Build",
        cell: (r) => (
          <Value
            text={wapYesNo(r.effective.build)}
            edited={r.effective.edited.build}
          />
        ),
      },
      {
        id: "strike",
        header: "Strike",
        cell: (r) => (
          <Value
            text={wapYesNo(r.effective.strike)}
            edited={r.effective.edited.strike}
          />
        ),
      },
      {
        id: "flags",
        header: "Flags",
        cell: (r) => <Flags flags={r.flags} />,
      },
    ],
    [],
  );

  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(r) => r.allocationId}
      caption="Work Access Pass list"
      emptyState={
        <p className="m-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nobody is on the list yet.
        </p>
      }
    />
  );
}

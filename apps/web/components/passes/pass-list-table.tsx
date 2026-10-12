"use client";

import * as React from "react";
import { AlertTriangle, Pencil, Ticket, X } from "lucide-react";
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
import { removePassAction } from "@/app/(app)/_project-passes/actions";
import { ShiftActionButton } from "@/components/shifts/shift-action-button";
import { EditPassDialog, type EditablePass } from "./edit-pass-dialog";

// The pass list (canvas W1): a table from md up, the same rows as cards on a
// phone (ResponsiveDataTable). Dates and build/strike are the EFFECTIVE values
// — the lead's override, else the member's roster plan, else (arrival only)
// the registration's first arrival — with "edited" where the lead changed one.
// Edit and remove are offered only while the list is editable; the server
// refuses them otherwise whatever this renders.

export interface PassRow extends EditablePass {
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

export function PassListTable({
  slug,
  rows,
  editable,
  window,
}: {
  slug: string;
  rows: PassRow[];
  editable: boolean;
  window: { earliest: string; latest: string } | null;
}) {
  const columns = React.useMemo<ResponsiveColumn<PassRow>[]>(() => {
    const cols: ResponsiveColumn<PassRow>[] = [
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
    ];
    if (editable) {
      cols.push({
        id: "actions",
        header: "Actions",
        hideHeader: true,
        role: "actions",
        align: "right",
        cell: (r) => (
          <span className="inline-flex items-center justify-end gap-1">
            <EditPassDialog slug={slug} pass={r} window={window} />
            <ShiftActionButton
              action={removePassAction}
              payload={{ slug, allocationId: r.allocationId }}
              confirm="Remove"
              pendingLabel="Removing…"
              successMessage={`${r.displayName} is off the list.`}
              variant="ghost"
              size="icon"
            >
              <X className="h-4 w-4" aria-hidden />
              <span className="sr-only">
                Remove {r.displayName} from the list
              </span>
            </ShiftActionButton>
          </span>
        ),
      });
    }
    return cols;
  }, [editable, slug, window]);

  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(r) => r.allocationId}
      caption="Work Access Pass list"
      emptyState={
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nobody is on the list yet.
        </p>
      }
    />
  );
}

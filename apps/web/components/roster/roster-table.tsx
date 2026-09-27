"use client";

import Link from "next/link";
import type { CampRosterRow, RosterBioStatus } from "@quagga/core";
import { ROSTER_ROLE_LABEL } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import {
  MemberArchiveButton,
  type MemberArchiveAction,
} from "./member-archive-button";

// The camp roster table (epic #55). NEEDS DESIGN REVIEW — built from existing
// components without a canvas frame.
//
// Renders ONLY the `CampRosterRow` it is handed: a list shape with no slot for
// a phone, an emergency contact, an ID number or a medical note. Medical notes
// live on a member's detail view, never here.

const BIO_LABEL: Record<RosterBioStatus, string> = {
  complete: "Complete",
  incomplete: "In progress",
  none: "Not started",
};

const BIO_VARIANT: Record<
  RosterBioStatus,
  "success" | "secondary" | "outline"
> = {
  complete: "success",
  incomplete: "secondary",
  none: "outline",
};

/** `2027-04-20` → `20 Apr`. The year is the edition's, so it is noise here. */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return "—";
  return value ? "Yes" : "No";
}

const COLUMNS: ResponsiveColumn<CampRosterRow>[] = [
  {
    id: "name",
    header: "Name",
    role: "title",
    cell: (row) => (
      <Link
        href={`/burners/${row.userId}`}
        className="font-medium underline-offset-2 hover:underline"
      >
        {row.displayName}
      </Link>
    ),
  },
  {
    id: "roles",
    header: "Roles",
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        <Badge
          variant={row.structuralRole === "member" ? "outline" : "default"}
        >
          {ROSTER_ROLE_LABEL[row.structuralRole]}
        </Badge>
        {row.projectRoles.map((r) => (
          <Badge key={r.id} variant="secondary">
            {r.name}
          </Badge>
        ))}
      </span>
    ),
  },
  {
    id: "bio",
    header: "Bio",
    role: "badge",
    cell: (row) => (
      <Badge variant={BIO_VARIANT[row.bioStatus]}>
        {BIO_LABEL[row.bioStatus]}
      </Badge>
    ),
  },
  {
    id: "arrival",
    header: "Arrival",
    cell: (row) => shortDate(row.logistics?.arrivalDate ?? null),
  },
  {
    id: "departure",
    header: "Departure",
    cell: (row) => shortDate(row.logistics?.departureDate ?? null),
  },
  {
    id: "build",
    header: "Build",
    cell: (row) => yesNo(row.logistics?.joiningBuild),
  },
  {
    id: "strike",
    header: "Strike",
    cell: (row) => yesNo(row.logistics?.joiningStrike),
  },
];

/** What the roster may offer on each row: membershipId → the ONE action this
 * viewer may take, as the server's @quagga/core predicate decided it (a row
 * absent from the map offers nothing). The actions re-decide on every call. */
export interface RosterRowActions {
  slug: string;
  byMembership: Record<string, "archive" | "restore">;
  archive: MemberArchiveAction;
  restore: MemberArchiveAction;
}

function actionsColumn(
  actions: RosterRowActions,
): ResponsiveColumn<CampRosterRow> {
  return {
    id: "actions",
    header: "Actions",
    role: "actions",
    hideHeader: true,
    align: "right",
    cell: (row) => {
      const mode = actions.byMembership[row.membershipId];
      if (!mode) return null;
      return (
        <MemberArchiveButton
          slug={actions.slug}
          membershipId={row.membershipId}
          displayName={row.displayName}
          mode={mode}
          action={mode === "archive" ? actions.archive : actions.restore}
        />
      );
    },
  };
}

export function RosterTable({
  rows,
  actions,
  label = "Camp roster",
}: {
  rows: CampRosterRow[];
  actions?: RosterRowActions;
  label?: string;
}) {
  const columns =
    actions && Object.keys(actions.byMembership).length > 0
      ? [...COLUMNS, actionsColumn(actions)]
      : COLUMNS;
  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(row) => row.membershipId}
      mobileAriaLabel={label}
      caption={<span className="sr-only">{label}</span>}
    />
  );
}

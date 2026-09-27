"use client";

import Link from "next/link";
import type { CampRosterRow, RosterBioStatus } from "@quagga/core";
import { ROSTER_ROLE_LABEL } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";

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

export function RosterTable({ rows }: { rows: CampRosterRow[] }) {
  return (
    <ResponsiveDataTable
      columns={COLUMNS}
      data={rows}
      getRowKey={(row) => row.membershipId}
      mobileAriaLabel="Camp roster"
      caption={<span className="sr-only">Camp roster</span>}
    />
  );
}

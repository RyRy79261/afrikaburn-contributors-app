"use client";

import Link from "next/link";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import type { RegistrationStatus } from "@quagga/types";
import type { Cohort } from "@/lib/org-logic";
import { CohortBadge } from "@/components/status-badges";

/** One registration row, pre-shaped by the server page (serializable only). */
export interface RegistrationTableRow {
  id: string;
  groupName: string;
  status: RegistrationStatus;
  soundShort: string;
  cohort: Cohort;
  submittedLabel: string;
}

/**
 * The registrations queue as a ResponsiveDataTable: a real <table> at md+ and
 * the designed stacked cards below md (frame NkPRL) instead of the old
 * horizontal scroll. Columns declared once; the server passes plain rows.
 */
export function RegistrationsTable({ rows }: { rows: RegistrationTableRow[] }) {
  const columns: ResponsiveColumn<RegistrationTableRow>[] = [
    {
      id: "camp",
      header: "Camp",
      role: "title",
      cellClassName: "font-medium",
      cell: (r) => (
        <Link href={`/registrations/${r.id}`} className="hover:text-accent">
          {r.groupName}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      role: "badge",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      id: "sound",
      header: "Sound",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (r) => r.soundShort,
    },
    {
      id: "cohort",
      header: "New / Ret.",
      cell: (r) => <CohortBadge cohort={r.cohort} />,
    },
    {
      id: "submitted",
      header: "Submitted",
      mobileHidden: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (r) => r.submittedLabel,
    },
  ];

  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(r) => r.id}
      rowClassName={() => "cursor-pointer"}
      caption="Registration pipeline"
    />
  );
}

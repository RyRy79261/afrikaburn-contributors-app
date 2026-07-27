"use client";

import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { Badge } from "@quagga/ui/components/badge";
import { ORG_RANK_LABELS, type OrgRank } from "@quagga/core";
import { AccountActions } from "@/components/account-actions";

/** One account row, pre-shaped by the server page (serializable only). */
export interface AccountTableRow {
  userId: string;
  /** Null when the viewer's rank may not read personal information — the column
   * is never selected server-side, so this is an absence, not a mask. */
  email: string | null;
  username: string | null;
  role: OrgRank | null;
  /** Free-text org department label, or null. */
  department: string | null;
  isDepartmentLead: boolean;
}

/**
 * The accounts list as a ResponsiveDataTable: a real <table> at md+ and the
 * designed stacked cards below md (frame y1idvL, whose mobile layout drops the
 * header row) instead of horizontal scroll.
 *
 * `canManage` and `showEmail` both come from the shared capability matrix on the
 * server (@quagga/core `org-permissions`) — the same one `setOrgStaffRole`
 * re-checks — so what renders and what would be permitted cannot drift apart.
 * The server action stays the boundary regardless.
 */
export function AccountsTable({
  rows,
  canManage,
  showEmail,
  selfUserId,
  caption = "Accounts",
}: {
  rows: AccountTableRow[];
  canManage: boolean;
  showEmail: boolean;
  selfUserId: string;
  /**
   * Accessible caption. The System panel renders the SAME table over a
   * different question — the standing org-access roster rather than a search
   * over every burner — so it names itself accordingly. One table, two callers:
   * reusing it is what keeps the access controls, the self-guard and the
   * System-manager row identical on both screens.
   */
  caption?: string;
}) {
  const columns: ResponsiveColumn<AccountTableRow>[] = [
    ...(showEmail
      ? [
          {
            id: "email",
            header: "Email",
            role: "title" as const,
            cellClassName: "font-medium",
            cell: (a: AccountTableRow) =>
              a.email ?? (
                <span className="italic text-muted-foreground">no email</span>
              ),
          },
        ]
      : []),
    {
      id: "username",
      header: "Username",
      // With no email column the handle IS the row's identity, so it takes the
      // title role rather than sitting in muted grey beside nothing.
      ...(showEmail
        ? { cellClassName: "text-muted-foreground" }
        : { role: "title" as const, cellClassName: "font-medium" }),
      cell: (a: AccountTableRow) => a.username ?? "—",
    },
    {
      id: "role",
      header: "Rank",
      role: "badge",
      cell: (a) =>
        a.role ? (
          <Badge variant={a.role === "god" ? "default" : "secondary"}>
            {ORG_RANK_LABELS[a.role]}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "department",
      header: "Department",
      cellClassName: "text-muted-foreground",
      cell: (a) =>
        a.department ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{a.department}</span>
            {a.isDepartmentLead && <Badge variant="outline">Team lead</Badge>}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "access",
      header: "Access",
      role: "actions",
      hideHeader: true,
      align: "right",
      cell: (a) =>
        canManage ? (
          <AccountActions
            userId={a.userId}
            // Frame node `xPit0` names the person by email in mono; the burner
            // name is the fallback when the account has no address.
            personLabel={a.email ?? a.username ?? "this account"}
            role={a.role}
            department={a.department}
            isDepartmentLead={a.isDepartmentLead}
            isSelf={a.userId === selfUserId}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <ResponsiveDataTable
      columns={columns}
      data={rows}
      getRowKey={(a) => a.userId}
      caption={caption}
    />
  );
}

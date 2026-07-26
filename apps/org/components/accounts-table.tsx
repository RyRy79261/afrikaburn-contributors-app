"use client";

import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { Badge } from "@quagga/ui/components/badge";
import { AccountActions } from "@/components/account-actions";

/** One account row, pre-shaped by the server page (serializable only). */
export interface AccountTableRow {
  userId: string;
  email: string | null;
  username: string | null;
  role: "god" | "org_staff" | null;
}

/**
 * The accounts list as a ResponsiveDataTable: a real <table> at md+ and the
 * designed stacked cards below md (frame y1idvL, whose mobile layout drops the
 * header row) instead of horizontal scroll. Access controls (AccountActions)
 * only render for the system owner; the server action stays the boundary.
 */
export function AccountsTable({
  rows,
  isGod,
  selfUserId,
}: {
  rows: AccountTableRow[];
  isGod: boolean;
  selfUserId: string;
}) {
  const columns: ResponsiveColumn<AccountTableRow>[] = [
    {
      id: "email",
      header: "Email",
      role: "title",
      cellClassName: "font-medium",
      cell: (a) =>
        a.email ?? (
          <span className="italic text-muted-foreground">no email</span>
        ),
    },
    {
      id: "username",
      header: "Username",
      cellClassName: "text-muted-foreground",
      cell: (a) => a.username ?? "—",
    },
    {
      id: "role",
      header: "Role",
      role: "badge",
      cell: (a) =>
        a.role === "god" ? (
          <Badge>Owner</Badge>
        ) : a.role === "org_staff" ? (
          <Badge variant="secondary">Org staff</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "access",
      header: "Access",
      role: "actions",
      hideHeader: true,
      align: "right",
      cell: (a) =>
        isGod ? (
          <AccountActions
            userId={a.userId}
            // Frame node `xPit0` names the person by email in mono; the burner
            // name is the fallback when the account has no address.
            personLabel={a.email ?? a.username ?? "this account"}
            role={a.role}
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
      caption="Accounts"
    />
  );
}

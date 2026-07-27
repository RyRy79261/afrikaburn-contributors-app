"use client";

import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { Badge } from "@quagga/ui/components/badge";
import { RoleBadge } from "@quagga/ui/components/role-badge";
import { ORG_RANK_LABELS, type OrgRank } from "@quagga/core";
import type { RoleColor } from "@quagga/types";
import {
  AccountActions,
  type AssignableRole,
} from "@/components/account-actions";
import {
  CapabilitySummary,
  type CapabilityGrantView,
} from "@/components/org-roles/capability-summary";

/** One org role an account holds, as the table renders it. */
export interface AccountRoleChip {
  id: string;
  name: string;
  color: RoleColor;
  departmentId: string | null;
  departmentName: string | null;
}

/** One account row, pre-shaped by the server page (serializable only). */
export interface AccountTableRow {
  userId: string;
  /** Null when the viewer may not read personal information — the column is
   * never selected server-side, so this is an absence, not a mask. */
  email: string | null;
  username: string | null;
  /** The console DOOR they hold, or null. Never their rights — see `roles`. */
  role: OrgRank | null;
  /** The org roles they hold — the names, for recognition. */
  roles: AccountRoleChip[];
  /**
   * What those roles RESOLVE TO — the union, computed server-side by the same
   * `@quagga/core` resolver that refuses the actions. Two columns rather than
   * one because they answer different questions: "which roles is this person
   * in?" (recognisable, editable) and "what can they actually do?" (the one a
   * reviewer needs, and the one nobody should have to derive by hand).
   */
  capabilities: CapabilityGrantView[];
}

/**
 * The accounts list as a ResponsiveDataTable: a real <table> at md+ and the
 * designed stacked cards below md (frame Ctdgd, whose mobile layout drops the
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
  assignableRoles = [],
  caption = "Accounts",
}: {
  rows: AccountTableRow[];
  canManage: boolean;
  showEmail: boolean;
  selfUserId: string;
  /** Every org role a System manager may assign. Empty for anyone else. */
  assignableRoles?: AssignableRole[];
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
      header: "Access",
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
      id: "roles",
      header: "Org roles",
      cellClassName: "text-muted-foreground",
      // The rights, as opposed to the door beside them. A System manager needs
      // "everything, always" said out loud rather than shown as an empty cell —
      // a god holds no role rows and needs none.
      cell: (a) =>
        a.role === "god" ? (
          <span className="text-xs">Everything, by anchor</span>
        ) : a.roles.length === 0 ? (
          <span className="text-xs italic">
            No roles yet — can sign in, can do nothing
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            {a.roles.map((r) => (
              <RoleBadge
                key={r.id}
                name={
                  r.departmentName ? `${r.name} · ${r.departmentName}` : r.name
                }
                color={r.color}
              />
            ))}
          </span>
        ),
    },
    {
      id: "capabilities",
      header: "What they can do",
      // THE UNION, RESOLVED. "What can this person delete?" is answerable from
      // this cell alone — including when the answer is "nothing", which is why
      // deletion always gets its own line instead of being absent from a list.
      cell: (a) =>
        a.role === null ? (
          <span className="text-xs text-muted-foreground">
            No console access
          </span>
        ) : (
          <CapabilitySummary
            grants={a.capabilities}
            emptyLabel={
              a.roles.length === 0
                ? "Nothing — the console opens empty until a role is assigned."
                : "Nothing: the roles they hold grant nothing at all."
            }
            className="max-w-[26rem]"
          />
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
            // Frame node `T6n33z` names the person by email in mono; the burner
            // name is the fallback when the account has no address.
            personLabel={a.email ?? a.username ?? "this account"}
            role={a.role}
            heldRoleIds={a.roles.map((r) => r.id)}
            assignableRoles={assignableRoles}
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

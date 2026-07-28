import Link from "next/link";
import { Search } from "lucide-react";
import {
  canReadPersonalInformationIn,
  isSystemManager,
  orgCapabilityRefusal,
} from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Input } from "@quagga/ui/components/input";
import { Button } from "@quagga/ui/components/button";
import { guardConsole } from "@/lib/gate";
import { listAssignableOrgRoles, searchAccounts } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import {
  AccountsTable,
  type AccountTableRow,
} from "@/components/accounts-table";

export const dynamic = "force-dynamic";

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const sp = await searchParams;
  const query = pick(sp.q);
  // Both flags come from the ONE matrix in @quagga/core, which is also what the
  // server actions re-check — so a control that renders is a control that works,
  // and a control that is missing is an action that would have been refused.
  const canManage = isSystemManager(session.actor);
  // Scoped to the `accounts` domain: a suppliers lead reads supply-related
  // details and not the org’s address book, unless their department owns it.
  const seesEmail = canReadPersonalInformationIn(session.actor, "accounts");
  const [accounts, assignableRoles] = await Promise.all([
    searchAccounts(session.orgGroupId, query, session.actor),
    // Only a System manager may assign, so only they need the list. Fetching it
    // for everyone would be a payload nobody else can act on.
    canManage ? listAssignableOrgRoles() : Promise.resolve([]),
  ]);
  // The table renders its columns as functions, so it is a client component;
  // the server hands it plain serializable rows (no Date, no query internals).
  const rows: AccountTableRow[] = accounts.map((a) => ({
    userId: a.userId,
    email: a.email,
    username: a.username,
    role: a.role,
    roles: a.roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
    })),
    // Resolved server-side by the same predicate the actions refuse with.
    capabilities: a.capabilities.map((c) => ({
      capability: c.capability,
      departments: c.departments,
      domains: c.domains,
    })),
  }));

  return (
    <div>
      <PageHeading
        title="Accounts"
        description={
          canManage
            ? "Who can open the console, and which org roles they hold. Access is the door; roles are what they may do once inside."
            : seesEmail
              ? "Find a burner and see the org access they hold. Only the system owner can change access."
              : // Two different people land here without email addresses and the
                // old copy named only one of them: an ENGINEER (whose rank
                // never sees personal information anywhere) and a DEPARTMENT
                // LEAD (whose department does not own the accounts screen).
                // Telling a suppliers lead they are an engineer is the kind of
                // small lie that teaches people to stop reading the console.
                `Find a burner by username and see the org access they hold. ${orgCapabilityRefusal(session.actor, "personal_information", "accounts")}`
        }
      />

      {canManage && (
        <p className="mb-5 text-sm text-muted-foreground">
          Roles, departments and what each role may do are managed in the{" "}
          <Link href="/system/roles" className="underline underline-offset-4">
            system panel
          </Link>
          . Here you decide who holds them — and the table says what that
          resolves to.
        </p>
      )}

      <form method="get" className="mb-5 flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            // The search FIELD narrows with the rank, because a search that
            // matches on email would be an oracle for the addresses the rank is
            // not allowed to read (see `searchAccounts`).
            placeholder={
              seesEmail ? "Search by email or username…" : "Search by username…"
            }
            className="pl-9"
            aria-label={
              seesEmail
                ? "Search accounts by email or username"
                : "Search accounts by username"
            }
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {query
              ? `No accounts match "${query}".`
              : "No accounts yet. They appear here as people sign in to the participant app."}
          </CardContent>
        </Card>
      ) : (
        /* Card chrome only at md+: below md the responsive table renders its own
           stacked cards (frame Ctdgd, whose header row is disabled), so an
           outer bordered box would double-nest. */
        <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow-sm">
          <AccountsTable
            rows={rows}
            canManage={canManage}
            showEmail={seesEmail}
            selfUserId={session.dbUserId}
            assignableRoles={assignableRoles.map((r) => ({
              id: r.id,
              name: r.name,
              color: r.color,
              departmentId: r.departmentId,
              departmentName: r.departmentName,
              departmentDomains: r.departmentDomains,
              capabilities: r.capabilities,
            }))}
          />
        </div>
      )}
    </div>
  );
}

import { Search } from "lucide-react";
import { orgCan, ORG_RANK_LABELS } from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Input } from "@quagga/ui/components/input";
import { Button } from "@quagga/ui/components/button";
import { guardConsole } from "@/lib/gate";
import { searchAccounts } from "@/lib/queries";
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
  const canManage = orgCan(session.actor, "manage_accounts");
  const seesEmail = orgCan(session.actor, "read_personal_information");
  const accounts = await searchAccounts(
    session.orgGroupId,
    query,
    session.actor,
  );
  // The table renders its columns as functions, so it is a client component;
  // the server hands it plain serializable rows (no Date, no query internals).
  const rows: AccountTableRow[] = accounts.map((a) => ({
    userId: a.userId,
    email: a.email,
    username: a.username,
    role: a.role,
    department: a.department,
    isDepartmentLead: a.isDepartmentLead,
  }));

  return (
    <div>
      <PageHeading
        title="Accounts"
        description={
          canManage
            ? "Find a burner, see their rank, and elevate trusted people to org staff or engineer."
            : seesEmail
              ? "Find a burner and see their org rank. Only the system owner can change access."
              : `Find a burner by username and see their org rank. ${ORG_RANK_LABELS.engineer} accounts don't see email addresses, and only the system owner can change access.`
        }
      />

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
           stacked cards (frame y1idvL, whose header row is disabled), so an
           outer bordered box would double-nest. */
        <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow-sm">
          <AccountsTable
            rows={rows}
            canManage={canManage}
            showEmail={seesEmail}
            selfUserId={session.dbUserId}
          />
        </div>
      )}
    </div>
  );
}

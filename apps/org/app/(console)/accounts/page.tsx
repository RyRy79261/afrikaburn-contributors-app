import { Search } from "lucide-react";
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
  const isGod = session.role === "god";
  const accounts = await searchAccounts(session.orgGroupId, query);
  // The table renders its columns as functions, so it is a client component;
  // the server hands it plain serializable rows (no Date, no query internals).
  const rows: AccountTableRow[] = accounts.map((a) => ({
    userId: a.userId,
    email: a.email,
    burnerName: a.burnerName,
    role: a.role,
  }));

  return (
    <div>
      <PageHeading
        title="Accounts"
        description={
          isGod
            ? "Find a burner, see their role, and elevate trusted people to org staff."
            : "Find a burner and see their org role. Only the system owner can change access."
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
            placeholder="Search by email or burner name…"
            className="pl-9"
            aria-label="Search accounts by email or burner name"
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
            isGod={isGod}
            selfUserId={session.dbUserId}
          />
        </div>
      )}
    </div>
  );
}

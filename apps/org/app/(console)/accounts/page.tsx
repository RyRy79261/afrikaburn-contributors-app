import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { Input } from "@quagga/ui/components/input";
import { Button } from "@quagga/ui/components/button";
import { guardConsole } from "@/lib/gate";
import { searchAccounts } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { AccountActions } from "@/components/account-actions";

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
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Burner name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Access</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.userId}>
                    <TableCell className="font-medium">
                      {a.email ?? (
                        <span className="italic text-muted-foreground">
                          no email
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.burnerName ?? "—"}
                    </TableCell>
                    <TableCell>
                      {a.role === "god" ? (
                        <Badge>Owner</Badge>
                      ) : a.role === "org_staff" ? (
                        <Badge variant="secondary">Org staff</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isGod ? (
                        <AccountActions
                          userId={a.userId}
                          role={a.role}
                          isSelf={a.userId === session.dbUserId}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";
import { UserCog } from "lucide-react";
import { orgCanInDomain, orgCapabilityRefusal } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Card, CardContent } from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { guardConsole } from "@/lib/gate";
import {
  getActiveEdition,
  getWranglerBoard,
  getWranglerCandidates,
} from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { BoardAssignWrangler } from "@/components/wranglers/board-assign";

// The wrangler board (roadmap M4-08): every APPROVED theme camp this edition and
// who is shepherding it.
//
// APPROVED ONLY, because assignment unlocks at approval — a board listing camps
// nobody may be assigned to is a to-do list of things you cannot do. The point
// of the screen is the UNASSIGNED rows: without it, finding a camp with no
// wrangler means opening every approved registration one at a time.
//
// READ FOR EVERY RANK. Who shepherds a camp is scheduling, not personal
// information — no email, no phone, no legal name is selected anywhere in
// `getWranglerBoard`. The RESTRICTION is on assigning, and it is shown in place
// rather than by hiding the control (Ryan, 28 Jul 2026).

export const dynamic = "force-dynamic";

export default async function WranglersPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { actor } = guard.session;
  const refusal = orgCanInDomain(actor, "update", "registrations")
    ? null
    : orgCapabilityRefusal(actor, "update", "registrations");

  const edition = await getActiveEdition();
  const [rows, candidates] = edition
    ? await Promise.all([
        getWranglerBoard(edition.id),
        getWranglerCandidates(guard.session.orgGroupId),
      ])
    : [[], []];

  const unassigned = rows.filter((r) => !r.wranglerUserId).length;

  return (
    <div>
      <PageHeading
        eyebrow="Console / Wranglers"
        title="Wrangler board"
        description={
          edition
            ? `Every approved theme camp for ${edition.name} and the wrangler shepherding it through build week and check-in. One camp, one wrangler.`
            : "Wrangler assignments belong to an edition. Once an edition is seeded, its approved camps appear here."
        }
      />

      {!edition ? (
        <EmptyState
          title="No active edition"
          description="Seed an edition and approve a camp, and it will show up here waiting for a wrangler."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No approved camps yet"
          description="A camp gets its wrangler when its registration is approved. Nothing has been approved for this edition."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {unassigned > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
              <UserCog className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                <strong>{unassigned}</strong> approved{" "}
                {unassigned === 1 ? "camp has" : "camps have"} nobody yet.
              </span>
            </p>
          )}

          {refusal && (
            <p className="rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
              {refusal}
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableCaption className="sr-only">
                  Approved theme camps and their wranglers
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Camp</TableHead>
                    <TableHead className="w-40">Open feedback</TableHead>
                    <TableHead className="w-72">Wrangler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.registrationId}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/registrations/${row.registrationId}`}
                          className="hover:text-accent hover:underline"
                        >
                          {row.campName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {/* DERIVED, never stored (migration 0026). The only
                            per-camp progress that is real today. */}
                        {row.openSectionReviews === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge variant="warning">
                            {row.openSectionReviews} open
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <BoardAssignWrangler
                          registrationId={row.registrationId}
                          campName={row.campName}
                          candidates={candidates}
                          currentWranglerUserId={row.wranglerUserId}
                          refusal={refusal}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

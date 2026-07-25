import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { Card, CardContent } from "@quagga/ui/components/card";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getRegistrationRows } from "@/lib/queries";
import {
  classifySoundLevel,
  SOUND_LEVEL_SHORT,
  type SoundLevel,
} from "@/lib/org-logic";
import { formatDate } from "@/lib/labels";
import { PageHeading } from "@/components/page-heading";
import { CohortBadge } from "@/components/status-badges";
import { RegistrationFilters } from "@/components/registration-filters";
import { RegistrationsPagination } from "@/components/registrations-pagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "all";
}

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const sp = await searchParams;
  const statusFilter = pick(sp.status);
  const soundFilter = pick(sp.sound);
  const cohortFilter = pick(sp.cohort);
  const pageParam = Number(pick(sp.page));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const edition = await getActiveEdition();
  const rows = edition ? await getRegistrationRows(edition) : [];

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (
      soundFilter !== "all" &&
      classifySoundLevel(r.soundRaw) !== (soundFilter as SoundLevel)
    ) {
      return false;
    }
    if (cohortFilter !== "all" && r.cohort !== cohortFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );

  return (
    <div>
      <PageHeading
        eyebrow="Registrations"
        title="Registration pipeline"
        description="Every camp, artwork, and mutant vehicle registration for the active edition. Filter by status, sound level, and whether the group registered in a prior year."
      />

      <RegistrationFilters
        status={statusFilter}
        sound={soundFilter}
        cohort={cohortFilter}
      />

      {!edition ? (
        <EmptyNote>
          No active edition is seeded yet — registrations appear once the
          database is seeded.
        </EmptyNote>
      ) : filtered.length === 0 ? (
        <EmptyNote>
          {rows.length === 0
            ? "No registrations have been started for this edition yet."
            : "No registrations match these filters."}
        </EmptyNote>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {filtered.length}{" "}
            {filtered.length === 1 ? "registration" : "registrations"}
          </p>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Camp</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sound</TableHead>
                    <TableHead>New / Ret.</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer">
                      <TableCell className="font-medium">
                        <Link
                          href={`/registrations/${r.id}`}
                          className="hover:text-accent"
                        >
                          {r.groupName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {SOUND_LEVEL_SHORT[classifySoundLevel(r.soundRaw)]}
                      </TableCell>
                      <TableCell>
                        <CohortBadge cohort={r.cohort} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {r.submittedAt
                          ? formatDate(r.submittedAt)
                          : "Not submitted"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <RegistrationsPagination
            page={current}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            params={{
              status: statusFilter,
              sound: soundFilter,
              cohort: cohortFilter,
            }}
          />
        </>
      )}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

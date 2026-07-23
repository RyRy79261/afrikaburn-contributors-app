import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import {
  Card,
  CardContent,
} from "@quagga/ui/components/card";
import { GROUP_KIND_LABELS } from "@/lib/labels";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getRegistrationRows } from "@/lib/queries";
import {
  classifySoundLevel,
  SOUND_LEVEL_LABELS,
  type SoundLevel,
} from "@/lib/org-logic";
import { PageHeading } from "@/components/page-heading";
import {
  CohortBadge,
  RegistrationStatusBadge,
} from "@/components/status-badges";
import { RegistrationFilters } from "@/components/registration-filters";

export const dynamic = "force-dynamic";

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
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Camp / project</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sound</TableHead>
                  <TableHead>Cohort</TableHead>
                  <TableHead className="text-right">Population</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        href={`/registrations/${r.id}`}
                        className="hover:text-accent"
                      >
                        {r.groupName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {GROUP_KIND_LABELS[r.groupKind] ?? r.groupKind}
                    </TableCell>
                    <TableCell>
                      <RegistrationStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {SOUND_LEVEL_LABELS[classifySoundLevel(r.soundRaw)]}
                    </TableCell>
                    <TableCell>
                      <CohortBadge cohort={r.cohort} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.expectedPopulation ?? "—"}
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

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

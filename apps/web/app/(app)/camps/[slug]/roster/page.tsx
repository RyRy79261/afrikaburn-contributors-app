import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Download, Users } from "lucide-react";
import {
  isRosterFiltered,
  ROSTER_QUERY_MAX,
  rosterFilterQuery,
  rosterRoleParam,
  type CampRosterStats,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { loadCampRoster } from "@/lib/roster-store";
import { PreviewNotice } from "@/components/preview-notice";
import { RosterFilters } from "@/components/roster/roster-filters";
import { RosterTable } from "@/components/roster/roster-table";

export const dynamic = "force-dynamic";

// The camp roster (epic #55 — CDB-030..033, STATS-017..019, STATS-022).
// NEEDS DESIGN REVIEW — built from existing components without a canvas frame.
//
// THE BOUNDARY IS THE SERVER: `loadCampRoster` resolves the viewer's
// membership of THIS camp and asks @quagga/core `canViewCampRoster` (the
// `view_member_details` project permission; lead/admin always) before a single
// member row is read. A refusal is a not-found — the SAME outcome as a slug
// that does not exist — so a free camp's roster cannot be discovered by
// guessing, and a lead of another camp gets nothing.
//
// The filter lives in the URL and is applied server-side, so a filtered view
// is a link. The stats card is aggregates only, over the whole camp.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

function StatsCard({ stats }: { stats: CampRosterStats }) {
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Members", value: String(stats.total) },
    { label: "New", value: String(stats.newcomers), hint: "First burn" },
    { label: "Returning", value: String(stats.returning) },
    {
      label: "Unknown",
      value: String(stats.unknown),
      hint: "No bio this year",
    },
    {
      label: "Bios complete",
      value: `${stats.biosComplete} / ${stats.total}`,
    },
    {
      label: "Officers",
      value: stats.officers.applies
        ? `${stats.officers.filled} / ${stats.officers.required}`
        : "—",
      hint: stats.officers.applies
        ? "Required slots filled"
        : "Applies once you register",
    },
  ];
  return (
    <Card data-testid="camp-stats">
      <CardHeader>
        <CardTitle className="text-base">Camp at a glance</CardTitle>
        <CardDescription>
          Totals for the whole camp this edition — never a per-person list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {t.value}
              </dd>
              {t.hint && (
                <dd className="text-[11px] text-muted-foreground">{t.hint}</dd>
              )}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function CampRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp roster" />;
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, edition, query] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
    searchParams,
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!edition) return <PreviewNotice feature="Camp roster" />;

  await enforceGate(viewer.id);

  const result = await loadCampRoster({
    slug: parsed.data.slug,
    viewerUserId: viewer.id,
    editionId: edition.id,
    searchParams: query,
  });
  if (!result) notFound();

  const { camp, roster, stats, filter, roleOptions } = result;
  const filterQuery = rosterFilterQuery(filter);
  const exportHref = `/camps/${camp.slug}/roster/export${
    filterQuery ? `?${filterQuery}` : ""
  }`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/camps/${camp.slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {camp.name}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Roster</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone in {camp.name} for {edition.name}, with their travel plans.
            Only people who can see member details can open this page.
          </p>
        </div>
        {/* A plain link to the route handler: the file is authorised there,
            on the request, exactly as this page is. */}
        <Button asChild variant="outline" size="sm">
          <a href={exportHref} download>
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </a>
        </Button>
      </div>

      <StatsCard stats={stats} />

      <RosterFilters
        initial={{
          q: firstParam(query.q).slice(0, ROSTER_QUERY_MAX),
          role: filter.role ? rosterRoleParam(filter.role) : "",
          bio: filter.bio ?? "",
        }}
        roleOptions={roleOptions.map((r) => ({
          value: rosterRoleParam({ kind: "project", roleId: r.id }),
          label: r.name,
        }))}
      />

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {isRosterFiltered(filter)
          ? `Showing ${roster.rows.length} of ${roster.total}`
          : `${roster.total} ${roster.total === 1 ? "person" : "people"}`}
      </p>

      {roster.rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" aria-hidden />}
          title="Nobody matches"
          description="Try a different name, or clear a filter."
        />
      ) : (
        <RosterTable rows={roster.rows} />
      )}
    </div>
  );
}

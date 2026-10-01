import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { shiftRangeLabel } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";

// The camp page's way into Shifts (canvas S1 "other states": the "Shifts ·
// Exploring" tile becomes this). Members only — the page never loads the
// summary for anyone else.
export function ShiftsTile({
  slug,
  canManage,
  summary,
}: {
  slug: string;
  canManage: boolean;
  summary: {
    shifts: number;
    open: number;
    teams: string[];
    firstDate: string | null;
    lastDate: string | null;
  };
}) {
  const range = shiftRangeLabel(summary.firstDate, summary.lastDate);
  const description =
    summary.shifts === 0
      ? canManage
        ? "Set up your camp's kitchen, tea bar, sound or MOOP rota — members pick what suits them."
        : "Your camp hasn't set up any shifts yet."
      : `${summary.teams.length ? `${summary.teams.join(", ")} — ` : ""}${summary.shifts} shift${summary.shifts === 1 ? "" : "s"}${range ? `, ${range}` : ""}.`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <CalendarClock className="h-4 w-4 text-accent" aria-hidden />
        {summary.open > 0 && (
          <Badge variant="warning">
            {summary.open} open spot{summary.open === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <p className="text-sm font-medium">Shifts</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Link
        href={`/camps/${slug}/shifts`}
        className="mt-auto inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {summary.shifts === 0 && canManage ? "Set up shifts" : "Open shifts"}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

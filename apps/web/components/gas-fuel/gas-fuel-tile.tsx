import Link from "next/link";
import { AlertTriangle, ArrowRight, Fuel } from "lucide-react";
import { formatLitres } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import type { GasFuelTileSummary } from "@/lib/gas-fuel-store";

// The camp page's "Gas & fuel record" tile (docs/registration-safety-spec.md;
// frames RJzGe / URe54). Members only. Its body line is the rough water guide
// — "a rough guide, not a water order" — because that is where a camp looks
// for it outside the registration.

export function GasFuelTile({
  slug,
  summary,
}: {
  slug: string;
  summary: GasFuelTileSummary;
}) {
  const water = summary.water
    ? `Rough water guide: about ${formatLitres(summary.water.litres)} for ${summary.water.people} ${summary.water.people === 1 ? "person" : "people"}.`
    : "Rough water guide: add your population and first arrival in section 4.";
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-testid="gas-fuel-tile"
    >
      <div className="flex items-center justify-between gap-2">
        <Fuel className="h-4 w-4 text-primary" aria-hidden />
        <Badge variant="outline">Optional</Badge>
      </div>
      <p className="text-sm font-medium">Gas &amp; fuel record</p>
      <p className="text-xs text-muted-foreground">
        {summary.savedSummary ? `Saved · ${summary.savedSummary}.` : "Not started."}{" "}
        {water}
      </p>
      {summary.advice && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Goes to the fuel depot
        </p>
      )}
      <Link
        href={`/camps/${slug}/gas-fuel`}
        className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open gas &amp; fuel record
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

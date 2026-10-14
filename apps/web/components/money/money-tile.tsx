import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { formatRand, moneyPath } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import type { MoneyTileSummary } from "@/lib/camp-money-store";

// The camp page's way into Money (docs/camp-budget-spec.md §Surfaces): the
// open-books totals for every current member, and "You owe R…" for the
// viewer. Members only — the page never loads the summary for anyone else.
// It records money; nothing on it pays anyone.

export function MoneyTile({
  slug,
  summary,
}: {
  slug: string;
  summary: MoneyTileSummary;
}) {
  const t = summary.totals;
  const shortfall = t.surplusCents < 0;
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-testid="money-tile"
    >
      <div className="flex items-center justify-between gap-2">
        <Wallet className="h-4 w-4 text-accent" aria-hidden />
        {summary.claimsToDecide !== null && summary.claimsToDecide > 0 && (
          <Badge variant="warning">
            {summary.claimsToDecide} claim
            {summary.claimsToDecide === 1 ? "" : "s"} to decide
          </Badge>
        )}
      </div>
      <p className="text-sm font-medium">Money</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Planned spend</dt>
        <dd className="text-right tabular-nums">
          {formatRand(t.plannedSpendCents)}
        </dd>
        <dt className="text-muted-foreground">Spent so far</dt>
        <dd className="text-right tabular-nums">
          {formatRand(t.actualSpendCents)}
        </dd>
        <dt className="text-muted-foreground">Income received</dt>
        <dd className="text-right tabular-nums">
          {formatRand(t.actualIncomeCents)}
        </dd>
        <dt className="text-muted-foreground">
          {shortfall ? "Shortfall" : "Surplus"}
        </dt>
        <dd
          className={
            shortfall
              ? "text-right font-medium text-warning tabular-nums"
              : "text-right tabular-nums"
          }
        >
          {formatRand(t.surplusCents)}
        </dd>
      </dl>
      <p className="text-xs" data-testid="money-tile-own">
        {summary.ownOutstandingCents > 0 ? (
          <span className="font-medium">
            You owe {formatRand(summary.ownOutstandingCents)}
          </span>
        ) : summary.ownStatus === "waived" ? (
          <span className="text-muted-foreground">Your dues are waived.</span>
        ) : summary.ownStatus === "paid" ? (
          <span className="text-muted-foreground">Your dues are paid up.</span>
        ) : (
          <span className="text-muted-foreground">You owe nothing yet.</span>
        )}
      </p>
      <Link
        href={moneyPath(slug)}
        className="mt-auto inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open money
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

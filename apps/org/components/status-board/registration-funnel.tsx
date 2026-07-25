import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { RegistrationStatus } from "@quagga/types";
import type { RegistrationFunnel } from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";

// The registration pipeline, in two shapes: the Overview's compact chip strip
// and the Status Board's full funnel rows. Both read the SAME
// `deriveRegistrationFunnel` counts — no separate tallies, no rounding tricks.
// Colours are the canvas contract (draft grey · submitted teal · under review
// apricot · changes requested red · approved sage); every bar is direct-labeled
// with its status name and count, so colour is never the only encoding.

const STATUS_META: Record<
  RegistrationStatus,
  { label: string; bar: string; dot: string }
> = {
  draft: {
    label: "Draft",
    bar: "bg-muted-foreground",
    dot: "bg-muted-foreground",
  },
  submitted: { label: "Submitted", bar: "bg-ab-teal", dot: "bg-ab-teal" },
  under_review: {
    label: "Under review",
    bar: "bg-ab-apricot",
    dot: "bg-ab-apricot",
  },
  changes_requested: {
    label: "Changes requested",
    bar: "bg-destructive",
    dot: "bg-destructive",
  },
  approved: { label: "Approved", bar: "bg-ab-sage", dot: "bg-ab-sage" },
  rejected: {
    label: "Rejected",
    bar: "bg-muted-foreground/60",
    dot: "bg-muted-foreground/60",
  },
  withdrawn: {
    label: "Withdrawn",
    bar: "bg-muted-foreground/40",
    dot: "bg-muted-foreground/40",
  },
};

/** The canvas funnel columns, in order. */
const FUNNEL_ORDER: RegistrationStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
];

/** Statuses shown only when they actually occurred (never a row of zeroes). */
const TAIL_ORDER: RegistrationStatus[] = ["rejected", "withdrawn"];

/** The Overview strip: pipeline chips + a link into the review queue. */
export function RegistrationPipelineStrip({
  funnel,
}: {
  funnel: RegistrationFunnel;
}) {
  const chips: RegistrationStatus[] = [
    "submitted",
    "under_review",
    "changes_requested",
    "approved",
  ];
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Registration pipeline</h2>
            <p className="text-xs text-muted-foreground">
              {funnel.total} registration{funnel.total === 1 ? "" : "s"} this
              edition
            </p>
          </div>
          <Link
            href="/registrations"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            Open the queue
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {funnel.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No registrations yet for this edition.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {chips.map((status) => {
              const meta = STATUS_META[status];
              return (
                <li
                  key={status}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-1.5"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${meta.dot}`}
                    aria-hidden
                  />
                  <span className="text-sm text-muted-foreground">
                    {meta.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {funnel.byStatus[status]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The Status Board funnel: one labelled, measured bar per status. */
export function RegistrationFunnelCard({
  funnel,
}: {
  funnel: RegistrationFunnel;
}) {
  const rows = [
    ...FUNNEL_ORDER,
    ...TAIL_ORDER.filter((s) => funnel.byStatus[s] > 0),
  ];
  const max = Math.max(1, ...rows.map((s) => funnel.byStatus[s]));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Registration funnel</h2>
          <p className="text-xs text-muted-foreground">
            {funnel.total} registration{funnel.total === 1 ? "" : "s"} · current
            edition
          </p>
        </div>

        {funnel.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No registrations yet for this edition.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((status) => {
              const meta = STATUS_META[status];
              const n = funnel.byStatus[status];
              const pct = Math.round((n / max) * 100);
              return (
                <li key={status} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-xs text-muted-foreground">
                    {meta.label}
                  </span>
                  <span className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                    <span
                      className={`block h-full rounded-md ${meta.bar}`}
                      style={{ width: `${n === 0 ? 0 : Math.max(pct, 2)}%` }}
                      aria-hidden
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {n}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

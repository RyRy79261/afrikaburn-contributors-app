import Link from "next/link";
import type {
  OfficerCoverage,
  WranglerCoverage,
  QuestionnaireCompletionRollup,
  SupplierOnboardingRollup,
} from "@quagga/core";
import { SUPPLIER_STANDINGS, standingLabel } from "@quagga/core";
import type { SupplierStanding } from "@quagga/types";
import { Card, CardContent } from "@quagga/ui/components/card";

// The coverage rails shared by the Overview and the Status Board: officer
// coverage, supplier onboarding (+ standings), questionnaire completion. Every
// figure is a @quagga/core derivation over real rows — the bars are drawn FROM
// the numbers shown beside them, so a bar can never imply a number that isn't
// in the data. Zero states say "nothing yet" rather than drawing an empty bar.

function RailHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}

function LegendDot({ className }: { className: string }) {
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
      aria-hidden
    />
  );
}

/**
 * Wrangler coverage — approved camps with a guardian angel, and without.
 *
 * This tile replaced a `DisabledHintTile` reading "Wrangler assignment isn't
 * built yet — there is no assignment data to report on." That was the honest
 * thing to show while it was true (the alternative was inventing counts), and
 * migration 0026 is what made it untrue.
 *
 * `busiestLoad` is shown because the headline can look healthy while one
 * volunteer quietly holds most of it. It is a DISTRIBUTION figure and it is
 * framed as one: it names how lopsided the roster is, never how anyone is
 * performing — this product does not measure people.
 */
export function WranglerCoverageCard({
  coverage,
}: {
  coverage: WranglerCoverage;
}) {
  const { eligibleCamps, assigned, unassigned, wranglers, busiestLoad } =
    coverage;
  const pct =
    eligibleCamps === 0 ? 0 : Math.round((assigned / eligibleCamps) * 100);

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <RailHead
          title="Wranglers"
          meta={`${eligibleCamps} approved camp${eligibleCamps === 1 ? "" : "s"}`}
        />
        {eligibleCamps === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is approved yet. A camp gets its wrangler when its
            registration is approved.
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold tabular-nums">
                {assigned} / {eligibleCamps}
              </span>
              <span className="text-xs text-muted-foreground">
                have a wrangler
              </span>
            </p>
            <span className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-ab-sage"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <LegendDot className="bg-ab-sage" />
                Assigned {assigned}
              </li>
              <li className="flex items-center gap-1.5">
                <LegendDot className="bg-muted-foreground" />
                {unassigned} waiting
              </li>
            </ul>
            <p className="mt-auto text-xs text-muted-foreground">
              {wranglers === 0
                ? "Nobody is wrangling yet."
                : `${wranglers} wrangler${wranglers === 1 ? "" : "s"} · busiest holds ${busiestLoad}`}{" "}
              ·{" "}
              <Link
                href="/wranglers"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Open the board
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Officer coverage across camps that are registered or in flight. */
export function OfficerCoverageCard({
  coverage,
}: {
  coverage: OfficerCoverage;
}) {
  const { applicableCamps, fullyOfficered, campsWithGaps, outstandingSlots } =
    coverage;
  const pct =
    applicableCamps === 0
      ? 0
      : Math.round((fullyOfficered / applicableCamps) * 100);

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <RailHead
          title="Officer coverage"
          meta={`${applicableCamps} registered camp${applicableCamps === 1 ? "" : "s"}`}
        />
        {applicableCamps === 0 ? (
          <p className="text-sm text-muted-foreground">
            No camps are registered or in review yet, so no officer requirements
            apply.
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold tabular-nums">
                {fullyOfficered} / {applicableCamps}
              </span>
              <span className="text-xs text-muted-foreground">
                fully officered
              </span>
            </p>
            <span className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-ab-sage"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <LegendDot className="bg-ab-sage" />
                Officered {fullyOfficered}
              </li>
              <li className="flex items-center gap-1.5">
                <LegendDot className="bg-muted-foreground" />
                {campsWithGaps} camp{campsWithGaps === 1 ? "" : "s"} with gaps ·{" "}
                {outstandingSlots} slot{outstandingSlots === 1 ? "" : "s"}{" "}
                outstanding
              </li>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Supplier onboarding distribution + the standing rollup. */
export function SupplierOnboardingCard({
  onboarding,
  standings,
}: {
  onboarding: SupplierOnboardingRollup;
  standings: Record<SupplierStanding, number>;
}) {
  const { total, onboarded, inProgress, notStarted } = onboarding;
  const segments = [
    { key: "complete", label: "Complete", n: onboarded, bar: "bg-ab-sage" },
    {
      key: "progress",
      label: "In progress",
      n: inProgress,
      bar: "bg-ab-apricot",
    },
    {
      key: "not-started",
      label: "Not started",
      n: notStarted,
      bar: "bg-muted-foreground",
    },
  ] as const;
  const present = SUPPLIER_STANDINGS.filter((s) => standings[s] > 0);

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <RailHead
          title="Supplier onboarding"
          meta={`${total} supplier${total === 1 ? "" : "s"}`}
        />
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suppliers in the repository yet.
          </p>
        ) : (
          <>
            <span className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
              {segments.map((s) =>
                s.n === 0 ? null : (
                  <span
                    key={s.key}
                    className={`block h-full ${s.bar}`}
                    style={{ width: `${(s.n / total) * 100}%` }}
                    aria-hidden
                  />
                ),
              )}
            </span>
            <ul className="flex flex-col gap-1 text-xs">
              {segments.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <LegendDot className={s.bar} />
                    {s.label}
                  </span>
                  <span className="font-semibold tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
            {present.length > 0 && (
              <div className="mt-auto border-t border-border pt-2">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                  Standing
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {present
                    .map((s) => `${standingLabel(s)} ${standings[s]}`)
                    .join(" · ")}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Completion rates for the edition's open questionnaire sends. */
export function QuestionnaireCompletionCard({
  rollup,
}: {
  rollup: QuestionnaireCompletionRollup;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <RailHead
          title="Questionnaire completion"
          meta={`${rollup.sends.length} active send${rollup.sends.length === 1 ? "" : "s"}`}
        />
        {rollup.sends.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No questionnaires are open right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rollup.sends.map((send) => (
              <li key={send.activationId} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{send.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {send.completed} / {send.sent} · {send.completionPct}%
                  </span>
                </div>
                <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-ab-teal"
                    style={{ width: `${send.completionPct}%` }}
                    aria-hidden
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

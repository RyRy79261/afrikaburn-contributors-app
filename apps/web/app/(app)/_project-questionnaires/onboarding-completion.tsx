import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { onboardingTickText, type OnboardingNamesFilter } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { cn } from "@quagga/ui/lib/utils";
import type {
  OnboardingCompletionView,
  OnboardingNameRow,
} from "@/lib/onboarding-store";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { CloseQuestionnaireButton } from "@/components/questionnaire/close-questionnaire-button";
import { closeQuestionnaireAction } from "@/app/(app)/camps/[slug]/questionnaires/actions";

// The lead's onboarding completion view (canvas A3, ONBOARD-020).
//
// TOTALS FIRST, NAMES ONLY ON DEMAND. The totals render on arrival; the list
// of who has and hasn't finished exists only behind "Show names", which is a
// link (`?names=…`) — so the names are not merely folded away in the page,
// they are not LOADED until asked for (onboarding-store `getOnboardingCompletion`
// runs no names query without it).

/** Complete / Closed / In progress / Not started (canvas A3 `oBuPo`). */
function StatusBadge({ n }: { n: OnboardingNameRow }) {
  if (n.status === "completed") {
    return (
      <Badge variant="success">
        Complete{n.completedAt ? ` · ${fmt(n.completedAt)}` : ""}
      </Badge>
    );
  }
  if (n.status === "expired") return <Badge variant="outline">Closed</Badge>;
  return n.openedAt ? (
    <Badge>In progress</Badge>
  ) : (
    <Badge variant="outline">Not started</Badge>
  );
}

/** "Opened 6 Apr · 1 of 3 ticked", "Not opened yet", or "Done". */
function progressText(n: OnboardingNameRow, boxes: number): string {
  if (n.status === "completed") return "Done";
  if (!n.openedAt) return "Not opened yet";
  return `Opened ${shortDate(n.openedAt)} · ${onboardingTickText(n.ticked, boxes)}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmt(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const FILTERS: { key: OnboardingNamesFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "incomplete", label: "Not complete" },
];

export function OnboardingCompletion({
  view,
  slug,
  base,
  names,
}: {
  view: OnboardingCompletionView;
  slug: string;
  /** This page's own path (the completion view). */
  base: string;
  names: OnboardingNamesFilter | null;
}) {
  const { activation, totals, memberCount } = view;
  const due = fmt(activation.dueAt);
  const recalled = activation.status === "closed";
  const tile = "rounded-lg border border-border bg-muted/30 p-4";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={`/camps/${slug}/questionnaires`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Questionnaires
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Onboarding</Badge>
          <BlockingBadge blocking={activation.blocking} />
          {recalled && <Badge variant="outline">Closed</Badge>}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {activation.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Sent to {totals.total} of {memberCount}{" "}
          {memberCount === 1 ? "member" : "members"}
          {due ? ` · due ${due}` : ""}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completion</CardTitle>
          <CardDescription>
            Totals first. Names stay folded away until you open the list.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            data-testid="onboarding-totals"
          >
            <div className={tile}>
              <dt className="text-sm text-muted-foreground">Complete</dt>
              <dd
                className="text-2xl font-semibold"
                data-testid="onboarding-complete"
              >
                {totals.complete} of {totals.total}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {totals.percent}%
              </dd>
            </div>
            <div className={tile}>
              <dt className="text-sm text-muted-foreground">New to the camp</dt>
              <dd className="text-2xl font-semibold">
                {totals.newComplete} of {totals.newTotal}
              </dd>
              <dd className="text-xs text-muted-foreground">complete</dd>
            </div>
            <div className={tile}>
              <dt className="text-sm text-muted-foreground">
                Returning to the camp
              </dt>
              <dd className="text-2xl font-semibold">
                {totals.returningComplete} of {totals.returningTotal}
              </dd>
              <dd className="text-xs text-muted-foreground">complete</dd>
            </div>
            <div className={tile}>
              <dt className="text-sm text-muted-foreground">Still to finish</dt>
              <dd className="text-2xl font-semibold">{totals.outstanding}</dd>
              <dd className="text-xs text-muted-foreground">
                {recalled
                  ? "closed — nobody still owes it"
                  : `${totals.inProgress} started · ${
                      totals.outstanding - totals.inProgress
                    } not opened`}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span>
                {totals.complete} of {totals.total} complete
              </span>
              <span className="text-accent">{totals.percent}%</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totals.percent}
              aria-label="Onboarding completion"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${totals.percent}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          {names === null ? (
            <Link
              href={`${base}?names=all`}
              className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              scroll={false}
            >
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex flex-col">
                <span className="text-base font-medium">Show names</span>
                <span className="text-sm text-muted-foreground">
                  Who has finished and who hasn&apos;t — {totals.total}{" "}
                  {totals.total === 1 ? "person" : "people"}.
                </span>
              </span>
            </Link>
          ) : (
            <Link
              href={base}
              className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              scroll={false}
            >
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-base font-medium">Hide names</span>
            </Link>
          )}
        </CardHeader>
        {names !== null && view.names && (
          <CardContent className="flex flex-col gap-3">
            <nav className="flex flex-wrap gap-2" aria-label="Filter names">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={`${base}?names=${f.key}`}
                  scroll={false}
                  aria-current={names === f.key ? "true" : undefined}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    names === f.key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-input text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            <p className="text-sm text-muted-foreground">
              Showing {view.names.length} of {totals.total}
            </p>
            {view.names.length > 0 && (
              <>
                {/* A phone gets one stacked row per person (canvas A3
                    `d60hfO`); four columns don't fit in 360px. */}
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border md:hidden">
                  {view.names.map((n) => (
                    <li
                      key={n.userId}
                      data-testid="onboarding-person"
                      className="flex flex-col gap-1 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">
                          {n.displayName}
                        </span>
                        <StatusBadge n={n} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {n.tenure === "new" ? "New" : "Returning"} ·{" "}
                        {progressText(n, view.summary.acknowledgements)}
                      </p>
                    </li>
                  ))}
                </ul>
                <Table className="hidden md:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>At this camp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.names.map((n) => (
                      <TableRow key={n.userId} data-testid="onboarding-person">
                        <TableCell>{n.displayName}</TableCell>
                        <TableCell>
                          {n.tenure === "new" ? "New" : "Returning"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge n={n} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {progressText(n, view.summary.acknowledgements)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {activation.status === "open" && (
        <div>
          <CloseQuestionnaireButton
            slug={slug}
            activationId={activation.id}
            blocking={activation.blocking}
            action={closeQuestionnaireAction}
          />
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, History, Pencil, ShieldAlert } from "lucide-react";
import {
  orgCanInDomain,
  orgCapabilityRefusal,
  wapAllocatedLabel,
  wapChangeLabel,
} from "@quagga/core";
import type { WapListStatus } from "@quagga/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { guardConsole } from "@/lib/gate";
import {
  loadWapReview,
  type OrgWapRequestView,
  type WapReview,
} from "@/lib/wap";
import { GROUP_KIND_LABELS, formatDate } from "@/lib/labels";
import { PROJECT_SUBJECT_NOUN } from "@/lib/project-review";
import { RegistrationTabs } from "@/components/passes/registration-tabs";
import {
  WapChangeLine,
  WapListStatusBadge,
  WapSinceApprovalBadge,
} from "@/components/passes/wap-badges";
import { ReviewPassList } from "@/components/passes/pass-list";
import { GrantRequest } from "@/components/passes/grant-request";
import { ListDecision } from "@/components/passes/list-decision";

// A registration's Work Access Passes panel (frame W2, mobile VBA9l): the
// project's requests with Grant / Decline, the list of names with their dates,
// build, strike and flags, and Approve / Return with a note.
//
// NAMES NEED `read` ON `registrations` — asked here, before anything is
// loaded, with `orgCanInDomain` (the console gate asks only the org-wide
// question). DECIDING needs `update` on `registrations`: the controls render
// disabled with the server's own refusal sentence for anyone without it, and
// every action re-checks.

export const dynamic = "force-dynamic";

export default async function RegistrationPassesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { actor } = guard.session;
  const { id } = await params;

  if (!orgCanInDomain(actor, "read", "registrations")) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {orgCapabilityRefusal(actor, "read", "registrations")}
        </CardContent>
      </Card>
    );
  }

  const review = await loadWapReview(id);
  if (!review) notFound();

  const refusal = orgCanInDomain(actor, "update", "registrations")
    ? null
    : orgCapabilityRefusal(actor, "update", "registrations");
  const noun = PROJECT_SUBJECT_NOUN[review.group.kind] ?? "project";
  const allocated = review.passes.length;

  const meta = [
    GROUP_KIND_LABELS[review.group.kind] ?? review.group.kind,
    review.edition.name,
    `${review.memberCount} member${review.memberCount === 1 ? "" : "s"}`,
    review.registration.status === "approved" && review.registration.decidedAt
      ? `registration approved ${formatDate(review.registration.decidedAt)}`
      : null,
  ].filter((m): m is string => Boolean(m));

  return (
    <div>
      <nav
        aria-label="Breadcrumb"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/" className="hover:text-foreground">
          Console
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <Link href="/registrations" className="hover:text-foreground">
          Registrations
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <span className="text-foreground">{review.group.name}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {review.group.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {meta.join(" · ")}
          </p>
        </div>
        <StatusBadge status={review.registration.status} />
      </header>

      <RegistrationTabs
        registrationId={review.registration.id}
        current="passes"
      />

      {/* Desktop: the list on the left, requests over the decision on the
          right (frame P8fPT). Phone: requests, then the list, then the
          decision (VBA9l) — a pending ask is the first thing to act on, and
          the decision is taken after reading the names. `grid-rows-[auto_1fr]`
          keeps the decision tucked under the requests however long the list. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="lg:col-start-2 lg:row-start-1">
          <RequestsCard review={review} refusal={refusal} noun={noun} />
        </div>

        {/* On a phone the list is not boxed: its rows are cards already. */}
        <Card className="min-w-0 overflow-hidden max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <CardHeader className="gap-3 max-md:px-0 max-md:pt-0 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">Pass list</CardTitle>
                <WapListStatusBadge status={review.list.status} />
                {review.list.badge && (
                  <WapSinceApprovalBadge
                    label={review.list.badge.label}
                    removedOnly={review.list.badge.removedOnly}
                  />
                )}
              </div>
              <CardDescription>{listCopy(review, noun)}</CardDescription>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 sm:w-48">
              <p className="text-sm text-muted-foreground sm:text-right">
                <span className="mr-1 text-2xl font-semibold text-foreground">
                  {allocated}
                </span>
                of {review.totalGranted} allocated
              </p>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Passes allocated"
                aria-valuemin={0}
                aria-valuemax={review.totalGranted}
                aria-valuenow={allocated}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${review.totalGranted > 0 ? Math.min(100, (allocated / review.totalGranted) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </CardHeader>
          <SinceApproval review={review} noun={noun} />
          <CardContent className="p-0 md:p-0">
            <ReviewPassList
              rows={review.passes.map((p) => ({
                allocationId: p.allocationId,
                displayName: p.displayName,
                effective: p.effective,
                flags: p.flags,
              }))}
            />
          </CardContent>
          <p className="flex items-start gap-2 border-border px-6 py-3 text-xs text-muted-foreground max-md:px-0 md:border-t">
            <Pencil
              className="mt-px h-3.5 w-3.5 shrink-0 text-accent"
              aria-hidden
            />
            edited — the {noun} changed this on the pass; the member&apos;s own
            plans say otherwise. Flags never block approval.
          </p>
        </Card>

        <Card className="lg:col-start-2 lg:row-start-2">
          <CardHeader>
            <CardTitle className="text-base">List decision</CardTitle>
            <CardDescription>
              {`Approve the whole list, or return it with a note the ${noun}'s leads will see.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ListDecision
              registrationId={review.registration.id}
              canDecide={review.list.status === "submitted"}
              waitingCopy={waitingCopy(review.list.status, noun)}
              refusal={refusal}
              subjectNoun={noun}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function waitingCopy(status: WapListStatus, noun: string): string {
  switch (status) {
    case "draft":
      return `The ${noun} hasn't submitted its list. It comes to you when they do.`;
    case "returned":
      return `You returned the list. It comes back to you when the ${noun} submits it again.`;
    case "approved":
      return `The list is approved. If the ${noun} changes it, it comes back to you.`;
    case "submitted":
      return "";
  }
}

function listCopy(review: WapReview, noun: string): string {
  const { list } = review;
  switch (list.status) {
    case "submitted":
      return `Submitted ${formatDate(list.submittedAt)}${list.submittedByName ? ` by ${list.submittedByName}` : ""}. Approve the whole list, or return it with a note.`;
    case "approved":
      return `Approved ${formatDate(list.approvedAt)}${list.reviewedByName ? ` by ${list.reviewedByName}` : ""}.`;
    case "returned":
      return `Returned ${formatDate(list.reviewedAt)}${list.returnNote ? ` with the note: “${list.returnNote}”` : ""}`;
    case "draft":
      return review.changes.everApproved
        ? `The ${noun} is changing the list you approved ${formatDate(list.approvedAt)}. It comes back to you when they submit it.`
        : `The ${noun} is still putting the list together.`;
  }
}

/** What changed since the list was approved (both W2 after-approval states). */
function SinceApproval({ review, noun }: { review: WapReview; noun: string }) {
  const { changes, list } = review;
  if (!changes.everApproved || !changes.any) return null;
  const byMembership = new Map(review.passes.map((p) => [p.membershipId, p]));
  const nameOf = (userId: string) =>
    review.removedNames.get(userId) ?? "A former member";

  if (list.status === "approved") {
    // Two things change an approved list without moving it to draft, and
    // neither is the lead's edit: a member leaving (their pass goes with them)
    // and a member changing their OWN roster plan, which a pass follows for
    // every field the lead did not override. Both are shown — the org approved
    // other values, and the export hands the gate what is current.
    return (
      <div className="mx-6 mb-4 rounded-lg border border-border bg-muted/30 p-3 max-md:mx-0">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden />
          Since you approved it
        </p>
        <ul className="flex flex-col gap-1.5">
          {changes.removed.map((p) => (
            <WapChangeLine key={`r-${p.membershipId}`} kind="removed">
              {nameOf(p.userId)} left the {noun}, so their pass went with them.
            </WapChangeLine>
          ))}
          {changes.changed.map((c) => (
            <WapChangeLine
              key={`c-${c.membershipId}-${c.field}`}
              kind="changed"
            >
              {byMembership.get(c.membershipId)?.displayName ?? "A member"} ·{" "}
              {wapChangeLabel(c)}
            </WapChangeLine>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          The list stays approved —{" "}
          {wapAllocatedLabel(review.passes.length, review.totalGranted)}.
          {changes.changed.length > 0 &&
            " A pass follows the member's own plans, so its dates can move after approval; the export shows what changed."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-6 mb-4 rounded-lg border border-border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Since you approved it
      </p>
      <ul className="flex flex-col gap-1.5">
        {changes.added.map((p) => (
          <WapChangeLine key={`a-${p.membershipId}`} kind="added">
            {byMembership.get(p.membershipId)?.displayName ?? "A member"} added
          </WapChangeLine>
        ))}
        {changes.removed.map((p) => (
          <WapChangeLine key={`r-${p.membershipId}`} kind="removed">
            {nameOf(p.userId)} removed
          </WapChangeLine>
        ))}
        {changes.changed.map((c) => (
          <WapChangeLine key={`c-${c.membershipId}-${c.field}`} kind="changed">
            {byMembership.get(c.membershipId)?.displayName ?? "A member"} ·{" "}
            {wapChangeLabel(c)}
          </WapChangeLine>
        ))}
      </ul>
    </div>
  );
}

function RequestsCard({
  review,
  refusal,
  noun,
}: {
  review: WapReview;
  refusal: string | null;
  noun: string;
}) {
  const answered = review.requests.filter((r) => r.status !== "pending");
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between space-y-0">
        <CardTitle className="text-base">Requests</CardTitle>
        <p className="text-sm text-muted-foreground">
          Total granted{" "}
          <span className="ml-1 text-lg font-semibold text-foreground">
            {review.totalGranted}
          </span>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {review.pending && (
          <div className="rounded-lg border-l-4 border-accent bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">
                Asks for {review.pending.requested}
                {review.pendingIsTopUp ? " more" : ""}
              </p>
              <Badge variant="warning">Pending</Badge>
            </div>
            {review.pending.reason && (
              <p className="mb-2 text-sm">“{review.pending.reason}”</p>
            )}
            <p className="mb-3 text-xs text-muted-foreground">
              {requestMeta(review.pending)}
            </p>
            <GrantRequest
              requestId={review.pending.id}
              requested={review.pending.requested}
              refusal={refusal}
            />
          </div>
        )}

        {answered.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {answered.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">Asked for {r.requested}</p>
                  {r.status === "granted" ? (
                    <Badge variant="success">Granted {r.granted}</Badge>
                  ) : (
                    <Badge variant="outline">Declined</Badge>
                  )}
                </div>
                {r.reason && (
                  <p className="text-sm text-muted-foreground">“{r.reason}”</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {requestMeta(r)} · {r.status} {formatDate(r.decidedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {review.requests.length === 0 && (
          <p className="text-sm text-muted-foreground">
            The {noun} hasn&apos;t asked for passes yet.
          </p>
        )}

        {review.legacyAsk !== null && (
          <div className="flex items-start gap-2 border-t border-border pt-3 text-sm">
            <History
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div>
              <p className="font-medium">
                Asked at registration: {review.legacyAsk}
              </p>
              <p className="text-xs text-muted-foreground">
                The number typed into the registration form before requests
                opened. For reference only.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function requestMeta(r: OrgWapRequestView): string {
  return [formatDate(r.createdAt), r.requestedByName]
    .filter(Boolean)
    .join(" · ");
}

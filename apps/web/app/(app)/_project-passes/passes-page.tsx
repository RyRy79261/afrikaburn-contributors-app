import { notFound, redirect } from "next/navigation";
import { Hourglass, Info, Send } from "lucide-react";
import {
  canManageWorkAccessPasses,
  decideWapAllocate,
  isWapListEditable,
  logisticsWindow,
  WAP_LIST_STATUS_LABELS,
  WAP_REQUEST_STATUS_LABELS,
  wapAllocatedLabel,
  wapPassesLeftLabel,
  wapPassesPath,
  wapProjectPagePath,
  wapRefusalMessage,
} from "@quagga/core";
import type { WapListStatus, WapRequestStatus } from "@quagga/types";
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { enforceGate, requireCampUser } from "@/lib/session";
import { loadWapPage } from "@/lib/wap-store";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { ShiftActionButton } from "@/components/shifts/shift-action-button";
import { AddMemberForm } from "@/components/passes/add-member-form";
import { PassListTable } from "@/components/passes/pass-list-table";
import { RequestBlock } from "@/components/passes/request-block";
import {
  wapDayLabel,
  wapLeftToHandOut,
  wapProjectNoun,
  wapRequestLine,
  wapRequestTitle,
} from "@/lib/wap-view";
import { submitPassListAction } from "./actions";

// The lead's Work Access Passes page (epic #53, docs/wap-spec.md, canvas W1
// sXjh1 / mobile rsnGI). One implementation for /camps, /artworks and
// /vehicles: `routeKind` names the route that rendered it, and a project is
// reached on the route of ITS kind (a camp URL for an artwork redirects; any
// other mismatch is the ordinary 404).
//
// WHO: the project's lead and co-leads (`canManageWorkAccessPasses`). Everyone
// else — a stranger, a former member, a plain member — gets the project's
// ordinary 404, decided BEFORE anything about passes is read: the flags on
// this page name other projects, free camps included (the decided, narrow
// exception in AGENTS.md), so the page must never render for anyone else.

export type PassesRouteKind = "theme_camp" | "artwork" | "mutant_vehicle";

const LIST_VARIANT: Record<WapListStatus, BadgeProps["variant"]> = {
  draft: "outline",
  submitted: "secondary",
  approved: "success",
  returned: "warning",
};

const REQUEST_VARIANT: Record<WapRequestStatus, BadgeProps["variant"]> = {
  pending: "secondary",
  granted: "success",
  declined: "destructive",
};

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export async function ProjectPassesPage({
  slug,
  routeKind,
}: {
  slug: string;
  routeKind: PassesRouteKind;
}) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Work Access Passes" />;
  }
  const user = await requireCampUser();
  await enforceGate(user.id);
  const edition = await getActiveEdition();
  if (!edition) return <PreviewNotice feature="Work Access Passes" />;

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp || !camp.viewerRole) notFound();
  if (camp.kind !== routeKind) {
    if (
      routeKind === "theme_camp" &&
      (camp.kind === "artwork" || camp.kind === "mutant_vehicle")
    ) {
      redirect(wapPassesPath(camp.kind, camp.slug));
    }
    notFound();
  }
  const mayManage = canManageWorkAccessPasses({
    structuralRole: camp.viewerRole,
  });
  if (!mayManage) notFound();

  const page = await loadWapPage({
    groupId: camp.id,
    editionId: edition.id,
    mayManage,
  });
  const noun = wapProjectNoun(camp.kind);
  const window = logisticsWindow(edition);
  const allocated = page.passes.length;
  const granted = page.totalGranted;
  const listStatus = page.list.status;
  const editable = page.registration !== null && isWapListEditable(listStatus);
  const pct = granted > 0 ? Math.min(100, (allocated / granted) * 100) : 0;

  // Whether "Add to the list" can succeed for SOME current member — the same
  // core rule the action enforces, minus who is picked.
  const addDecision = decideWapAllocate({
    mayManage,
    listStatus,
    totalGranted: granted,
    allocatedCount: allocated,
    memberEligible: true,
    alreadyOnList: false,
  });
  const addHint = addDecision.ok
    ? `${wapPassesLeftLabel(allocated, granted)}. Only current members of the ${noun} can hold one.`
    : wapRefusalMessage(addDecision.reason);

  // Oldest first for numbering ("First request"), newest first for display.
  const oldestFirst = [...page.requests].reverse();
  const indexOf = new Map(oldestFirst.map((r, i) => [r.id, i]));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <ShiftsHeader
        backHref={wapProjectPagePath(camp.slug)}
        backLabel={camp.name}
        title="Work Access Passes"
        description={`A pass lets someone onto site before the event opens, to build, or after it closes, to strike. AfrikaBurn grants the ${noun} a number of passes; you choose who holds them.`}
      />

      {page.registration === null ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6">
          <Info className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Register first</h2>
          <p className="text-sm text-muted-foreground">
            Passes belong to the {noun}&apos;s registration for {edition.name}.
            Submit the registration, then ask for passes here once AfrikaBurn
            opens requests.
          </p>
        </section>
      ) : page.window === "not_opened" && page.requests.length === 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6">
          <Hourglass className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">
            Requests aren&apos;t open yet
          </h2>
          <p className="text-sm text-muted-foreground">
            AfrikaBurn opens Work Access Pass requests for the edition. Every
            lead and co-lead gets a notification when they do.
          </p>
        </section>
      ) : (
        <RequestBlock
          slug={camp.slug}
          noun={noun}
          windowState={page.window}
          totalGranted={granted}
          isFirst={page.requests.length === 0}
          requestBlocked={page.requestBlocked}
        >
          {page.requests.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat
                  label="Granted"
                  value={String(granted)}
                  note="Every granted request, added up"
                />
                <Stat
                  label="Asked, waiting"
                  value={page.pending ? `${page.pending.requested} more` : "—"}
                  note={
                    page.pending
                      ? `Sent ${wapDayLabel(page.pending.createdAt)}`
                      : "Nothing waiting on AfrikaBurn"
                  }
                />
                <Stat
                  label="Allocated"
                  value={`${allocated} of ${granted}`}
                  note={wapLeftToHandOut(allocated, granted)}
                />
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Request history
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {page.requests.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {wapRequestTitle(r, indexOf.get(r.id) ?? 0)}
                        </span>
                        <Badge variant={REQUEST_VARIANT[r.status]}>
                          {WAP_REQUEST_STATUS_LABELS[r.status]}
                        </Badge>
                      </div>
                      {r.reason && (
                        <p className="text-sm">&ldquo;{r.reason}&rdquo;</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {wapRequestLine(r)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </RequestBlock>
      )}

      {page.registration !== null && (granted > 0 || allocated > 0) && (
        <section aria-labelledby="wap-list" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex max-w-2xl flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="wap-list" className="text-2xl font-semibold">
                  Pass list
                </h2>
                <Badge variant={LIST_VARIANT[listStatus]}>
                  {WAP_LIST_STATUS_LABELS[listStatus]}
                </Badge>
                {page.list.sinceApproval && (
                  <Badge
                    variant="outline"
                    className="normal-case tracking-normal"
                  >
                    {page.list.sinceApproval}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Dates and build or strike come from each member&apos;s own plans
                on the roster. Change one here and it shows as edited.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-72">
              <p className="text-sm text-muted-foreground">
                <span className="mr-1.5 text-2xl font-semibold text-foreground">
                  {allocated}
                </span>
                {wapAllocatedLabel(allocated, granted).replace(/^\d+ /, "")}
              </p>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Passes allocated"
                aria-valuemin={0}
                aria-valuemax={granted}
                aria-valuenow={allocated}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>

          {listStatus === "submitted" && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">Submitted</Badge>
                <span className="text-sm text-muted-foreground">
                  {wapAllocatedLabel(allocated, granted)}
                </span>
              </div>
              <p className="text-sm">
                Submitted
                {page.list.submittedAt
                  ? ` ${wapDayLabel(page.list.submittedAt)}`
                  : ""}
                {page.list.submittedByName
                  ? ` by ${page.list.submittedByName}`
                  : ""}
                . The list can&apos;t change until AfrikaBurn approves it or
                sends it back.
              </p>
            </div>
          )}

          {listStatus === "returned" && (
            <div className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="warning">Returned</Badge>
                {page.list.reviewedAt && (
                  <span className="text-sm text-muted-foreground">
                    {wapDayLabel(page.list.reviewedAt)}
                  </span>
                )}
              </div>
              {page.list.returnNote && (
                <blockquote className="rounded-md border-l-4 border-warning bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Note from AfrikaBurn
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm">
                    {page.list.returnNote}
                  </p>
                </blockquote>
              )}
              <p className="text-sm text-muted-foreground">
                The list is editable again. Submit it when it&apos;s ready.
              </p>
            </div>
          )}

          {listStatus === "approved" && (
            <p className="rounded-xl border border-border bg-card p-4 text-sm">
              AfrikaBurn approved the list
              {page.list.approvedAt
                ? ` on ${wapDayLabel(page.list.approvedAt)}`
                : ""}
              . Changing it sends it back to draft — you&apos;d submit it again.
            </p>
          )}

          <PassListTable
            slug={camp.slug}
            editable={editable}
            window={window}
            rows={page.passes.map((p) => ({
              allocationId: p.allocationId,
              displayName: p.displayName,
              overrides: p.overrides,
              plan: p.plan,
              effective: {
                arrivalDate: p.effective.arrivalDate,
                departureDate: p.effective.departureDate,
                build: p.effective.build,
                strike: p.effective.strike,
                edited: p.effective.edited,
              },
              flags: p.flags,
            }))}
          />

          {editable && (
            <AddMemberForm
              slug={camp.slug}
              candidates={page.candidates}
              hint={addHint}
              disabled={!addDecision.ok}
            />
          )}

          {(listStatus === "draft" || listStatus === "returned") && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex max-w-2xl flex-col gap-1">
                <h3 className="font-semibold">Ready to send the list?</h3>
                <p className="text-sm text-muted-foreground">
                  AfrikaBurn approves the whole list at once. Once you submit,
                  the list is locked until they approve it or send it back.
                </p>
                {page.submitBlocked && (
                  <p className="text-sm text-muted-foreground">
                    {page.submitBlocked}
                  </p>
                )}
              </div>
              {page.submitBlocked === null && (
                <ShiftActionButton
                  action={submitPassListAction}
                  payload={{ slug: camp.slug }}
                  pendingLabel="Submitting…"
                  successMessage="The list is with AfrikaBurn."
                  variant="default"
                  size="default"
                  className="w-full sm:w-auto"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  Submit to AfrikaBurn
                </ShiftActionButton>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

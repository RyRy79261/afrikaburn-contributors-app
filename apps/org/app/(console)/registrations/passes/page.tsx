import { Download, Lock, ShieldAlert } from "lucide-react";
import {
  filterWapOverview,
  orgCanInDomain,
  orgCapabilityRefusal,
  WAP_OVERVIEW_STATUS_LABELS,
  WAP_OVERVIEW_STATUSES,
  wapDateLabel,
  wapOverviewStatus,
  wapOverviewTotals,
  type WapOverviewStatus,
} from "@quagga/core";
import { GroupKind } from "@quagga/types";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition } from "@/lib/queries";
import { getWapWindow, loadWapOverview, type WapWindowView } from "@/lib/wap";
import { formatDate } from "@/lib/labels";
import { PageHeading } from "@/components/page-heading";
import { WapWindowControl } from "@/components/passes/wap-window-control";
import { WapOverviewFilters } from "@/components/passes/wap-overview-filters";
import { WapOverviewTable } from "@/components/passes/wap-overview-table";

// /registrations/passes — every project's Work Access Passes for the active
// edition (frame W3, mobile T0yoB): the request window, the totals, a table
// filtered by list status, project type and pending requests, and the CSV
// hand-off (WAP-009).
//
// EVERY project whose registration may ask is listed, asked or not (Ryan,
// 13 Oct 2026): one that never asked reads 0 / 0 / 0 and "Not asked". The
// CSV holds APPROVED lists only (same day) — the copy here says so.
//
// `read` on `registrations` opens it (it names projects). Opening and closing
// requests needs `update`; the export needs `personal_information` — both are
// rendered disabled with the server's own refusal for anyone without them, and
// both are re-checked server-side.

export const dynamic = "force-dynamic";

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WapOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { actor } = guard.session;

  const heading = (
    <PageHeading
      eyebrow="Console / Registrations"
      title="Work Access Passes"
      description="Every project's passes for the edition: what it asked for, what you granted, and how many people it has named."
    />
  );

  if (!orgCanInDomain(actor, "read", "registrations")) {
    return (
      <div>
        {heading}
        <Notice>{orgCapabilityRefusal(actor, "read", "registrations")}</Notice>
      </div>
    );
  }

  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <div>
        {heading}
        <Notice>
          No active edition is seeded yet — passes appear once there is one.
        </Notice>
      </div>
    );
  }

  const sp = await searchParams;
  const statusRaw = pick(sp.status);
  const status = WAP_OVERVIEW_STATUSES.find((s) => s === statusRaw) ?? null;
  const kindParam = GroupKind.safeParse(pick(sp.kind));
  const filter = {
    status,
    kind: kindParam.success ? kindParam.data : null,
    pendingOnly: pick(sp.pending) === "1",
  };

  const [rows, window] = await Promise.all([
    loadWapOverview(edition.id),
    getWapWindow(edition.id),
  ]);
  const totals = wapOverviewTotals(rows);
  const shown = filterWapOverview(rows, filter);

  const windowRefusal = orgCanInDomain(actor, "update", "registrations")
    ? null
    : orgCapabilityRefusal(actor, "update", "registrations");
  const exportRefusal = orgCanInDomain(
    actor,
    "personal_information",
    "registrations",
  )
    ? null
    : orgCapabilityRefusal(actor, "personal_information", "registrations");

  // Not asked + the four list statuses: adds up to every project listed.
  const statusCounts = WAP_OVERVIEW_STATUSES.map((s: WapOverviewStatus) => ({
    s,
    n: rows.filter((r) => wapOverviewStatus(r) === s).length,
  })).filter((c) => c.n > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Console / Registrations"
        title="Work Access Passes"
        description="Every project's passes for the edition: what it asked for, what you granted, and how many people it has named."
        actions={
          exportRefusal ? (
            <div className="flex flex-col items-end gap-1">
              <Button variant="outline" disabled>
                <Download aria-hidden />
                Export approved lists
              </Button>
              <p className="flex max-w-xs items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert
                  className="mt-px h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                {exportRefusal}
              </p>
            </div>
          ) : (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href="/api/registrations/passes/export" download>
                <Download aria-hidden />
                Export approved lists
              </a>
            </Button>
          )
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:gap-6">
          <div className="md:border-r md:border-border md:pr-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Edition
            </p>
            <p className="font-medium">
              {edition.name} · {wapDateLabel(edition.startDate)} –{" "}
              {wapDateLabel(edition.endDate)}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              WAP requests
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <WindowBadge window={window} />
              <span className="text-sm text-muted-foreground">
                {windowCopy(window)}
              </span>
            </div>
          </div>
          <WapWindowControl
            editionId={edition.id}
            action={window.state === "open" ? "close" : "open"}
            refusal={windowRefusal}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Requested"
          value={String(totals.requested)}
          sub={`${totals.projectsAsked} of ${totals.projects} project${totals.projects === 1 ? "" : "s"} asked · ${totals.projectsNotAsked} not asked yet`}
        />
        <Stat
          label="Granted"
          value={String(totals.granted)}
          sub={`Across ${totals.projectsGranted} project${totals.projectsGranted === 1 ? "" : "s"}`}
        />
        <Stat
          label="Allocated"
          value={`${totals.allocated} of ${totals.granted}`}
          sub="Names on lists"
        />
        <Stat
          label="Pending requests"
          value={String(totals.pendingRequests)}
          sub={`${totals.pendingPasses} pass${totals.pendingPasses === 1 ? "" : "es"} asked for`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <WapOverviewFilters
          status={filter.status ?? "all"}
          kind={filter.kind ?? "all"}
          pendingOnly={filter.pendingOnly}
          pendingCount={totals.pendingRequests}
        />
        <p className="text-sm text-muted-foreground">
          {shown.length} project{shown.length === 1 ? "" : "s"}
        </p>
      </div>

      {rows.length === 0 ? (
        <Notice>
          No project has a submitted registration for this edition yet —
          projects appear here once they submit theirs.
        </Notice>
      ) : (
        <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow-sm">
          <WapOverviewTable rows={shown} />
        </div>
      )}

      {statusCounts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Lists:{" "}
          {statusCounts
            .map(
              ({ s, n }) =>
                `${n} ${WAP_OVERVIEW_STATUS_LABELS[s].toLowerCase()}`,
            )
            .join(" · ")}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        The CSV holds only people on approved lists — drafts, submitted and
        returned lists are left out — with their email, arrival, departure,
        build and strike, and what changed since approval. It needs the
        personal-information permission in Registrations, and never holds a
        phone number, emergency contact or ID.
      </p>
    </div>
  );
}

function WindowBadge({ window }: { window: WapWindowView }) {
  switch (window.state) {
    case "open":
      return <Badge variant="success">Open</Badge>;
    case "closed":
      return <Badge variant="outline">Closed</Badge>;
    case "not_opened":
      return <Badge variant="secondary">Not open</Badge>;
  }
}

function windowCopy(window: WapWindowView): string {
  switch (window.state) {
    case "open":
      return `Opened ${formatDate(window.openedAt)} · projects can ask for passes, and ask for more`;
    case "closed":
      return `Closed ${formatDate(window.closedAt)}. Projects can't ask for passes. Lists can still be edited and submitted.`;
    case "not_opened":
      return "Opening sends every lead and co-lead with a submitted registration an in-app notification.";
  }
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

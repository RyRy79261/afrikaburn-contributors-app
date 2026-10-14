import type { ReactNode } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Hand,
  Map as MapIcon,
  Monitor,
  TriangleAlert,
} from "lucide-react";
import {
  boundaryDimensions,
  formatPlotSize,
  getLayoutCatalog,
  layoutObjectName,
  plotSummary,
  type LayoutWarning,
} from "@quagga/core";
import type { LayoutDocument } from "@quagga/types";
import { LayoutPlan } from "@quagga/ui/components/layout-plan";
import { planFileName } from "@quagga/ui/lib/layout-plan-model";
import { lastEditedLine, layoutPath, layoutPrintPath } from "@/lib/layout-view";
import { DownloadPlanButton, PrintPlanLink } from "./plan-actions";
import { PlanViewport } from "./plan-viewport";
import { LayoutObjectList } from "./layout-object-list";

// THE READ-ONLY PLAN PAGE BODY (docs/camp-layout-spec.md §Surfaces; frame L3
// QZeG7 desktop, t7aOZ3 at 360). Plain members get this at every width, and
// so does everyone below 768 px (decision 13: 360 is view-only).
//
// It is given the document and nothing else: no warnings (editors only, 14
// Oct decision) and no version. The drawing is the server-rendered SVG from
// @quagga/ui; the phone's pinch and pan only transform it.
//
// Every current member may download the PNG and print (14 Oct decision).
// The PNG is always made from the full drawing — rulers, scale bar and
// frontage — even on a phone, where that drawing is not the one on screen.

export const PLAN_SVG_ID = "camp-layout-plan";

export interface LayoutReadOnlyProps {
  slug: string;
  editionYear: number;
  document: LayoutDocument;
  updatedAt: Date;
  updatedByName: string | null;
  /** A shade structure's covered area, opened; null for the whole camp. The
   * page has already checked it names one. */
  areaId: string | null;
  /** An editor on a phone: says where editing happens. */
  editorOnPhone: boolean;
  /** The plan's warnings — given ONLY for an editor (14 Oct decision:
   * warnings are for leads, co-leads and `manage_layout`), who sees them
   * below 768 px, where the editor's own panel is not mounted (frames vnpZw,
   * PGk6q). Null for everyone else, and never rendered from 768 px. */
  warnings?: readonly LayoutWarning[] | null;
  now: Date;
  /** The page's back link, title and subtitle. */
  header: ReactNode;
}

export function LayoutReadOnly({
  slug,
  editionYear,
  document: doc,
  updatedAt,
  updatedByName,
  areaId,
  editorOnPhone,
  warnings = null,
  now,
  header,
}: LayoutReadOnlyProps) {
  const catalog = getLayoutCatalog(editionYear);
  const parent = areaId
    ? (doc.plot.objects.find((o) => o.id === areaId) ?? null)
    : null;
  const child = parent?.child ?? null;
  const parentName = parent ? layoutObjectName(parent, catalog) : null;
  const summary = plotSummary(doc, catalog);

  const areaName = (id: string) => {
    const o = doc.plot.objects.find((x) => x.id === id);
    return o ? layoutObjectName(o, catalog) : "a covered area";
  };
  // Inside a covered area, that area's warnings; on the whole camp, all of
  // them, the nested ones named by their area as the editor's panel does.
  const shownWarnings =
    editorOnPhone && warnings
      ? warnings.filter((w) => !areaId || w.areaId === areaId)
      : [];

  // The objects those warnings name, outlined on the phone's plan (frame
  // vnpZw). Undefined for everyone who is not an editor.
  const warnedIds =
    shownWarnings.length > 0
      ? new Set(shownWarnings.flatMap((w) => w.objectIds))
      : undefined;

  const sizeLine = child
    ? `Covered ${formatPlotSize(boundaryDimensions(child.boundary))}`
    : `Plot ${formatPlotSize(summary)}`;
  const title = parentName
    ? `${parentName}, inside: the camp's plan to scale`
    : "The whole camp, drawn to scale";

  // One grid: on a phone the header, the plan, the list, then the buttons;
  // from 768 px the buttons sit beside the title and the list beside the
  // plan (frames t7aOZ3 / QZeG7).
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex flex-col gap-3 md:col-start-1 md:row-start-1">
        {header}
        {editorOnPhone && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground md:hidden">
            <Monitor
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            Editing needs a tablet or computer. On a phone the plan is
            view-only.
          </p>
        )}
      </div>
      <div className="order-last grid grid-cols-2 gap-3 md:order-none md:col-start-2 md:row-start-1 md:flex md:items-end md:justify-end">
        <DownloadPlanButton
          svgId={PLAN_SVG_ID}
          fileName={planFileName(slug, editionYear, parentName)}
        />
        <PrintPlanLink href={layoutPrintPath(slug)} />
      </div>

      <section
        aria-label="Camp plan"
        data-plan-surface=""
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 md:col-start-1 md:row-start-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {parentName ? (
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1 text-sm"
            >
              <Link
                href={layoutPath(slug)}
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <MapIcon className="h-4 w-4" aria-hidden />
                Whole camp
              </Link>
              <ChevronRight
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <span className="font-semibold" aria-current="page">
                {parentName}
              </span>
            </nav>
          ) : (
            <h2 className="flex items-center gap-2 font-semibold">
              <MapIcon className="h-4 w-4 text-primary" aria-hidden />
              Whole camp
            </h2>
          )}
          <p className="font-mono text-xs text-muted-foreground sm:text-sm">
            {sizeLine}
          </p>
        </div>

        <div className="hidden md:block">
          <LayoutPlan
            id={PLAN_SVG_ID}
            doc={doc}
            catalog={catalog}
            areaId={areaId}
            variant="full"
            title={title}
            openHref={(id) => layoutPath(slug, id)}
          />
        </div>
        <div className="md:hidden">
          <PlanViewport>
            <LayoutPlan
              id={`${PLAN_SVG_ID}-compact`}
              doc={doc}
              catalog={catalog}
              areaId={areaId}
              variant="compact"
              title={title}
              highlightIds={warnedIds}
            />
          </PlanViewport>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Hand className="h-4 w-4" aria-hidden />
            Pinch to zoom, drag to pan
          </p>
          {child && (
            <p className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-foreground" aria-hidden />
                Pole
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-ab-apricot" aria-hidden />
                Guy ropes, keep clear
              </span>
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground md:text-center">
          {lastEditedLine(updatedAt, updatedByName, now)}
        </p>
      </section>

      {editorOnPhone && warnings && (
        <section
          aria-label="Warnings"
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 md:hidden"
        >
          <h2 className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
            Warnings
            <span className="rounded-full bg-warning/20 px-2 text-xs font-semibold text-warning">
              {shownWarnings.length}
            </span>
          </h2>
          {shownWarnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No warnings on this plan.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shownWarnings.map((w, i) => (
                <li
                  key={`${w.code}-${w.objectIds.join("-")}-${i}`}
                  className="rounded-lg bg-muted/60 p-3"
                >
                  <span className="block text-sm font-semibold">
                    {w.message}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {w.areaId && !areaId ? `Inside ${areaName(w.areaId)} · ` : ""}
                    {w.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            Shown to leads and layout editors. Advice only.
          </p>
        </section>
      )}

      <section
        aria-label="Objects"
        className="self-start rounded-xl border border-border bg-card p-4 md:col-start-2 md:row-start-2"
      >
        <LayoutObjectList
          slug={slug}
          catalog={catalog}
          objects={child ? child.objects : doc.plot.objects}
          totalCount={child ? child.objects.length : doc.plot.objects.length}
          nestedLevel={child !== null}
        />
        {child && (
          <p className="mt-3 text-xs text-muted-foreground">
            Tent labels are free text. They aren&apos;t linked to anyone&apos;s
            account.
          </p>
        )}
      </section>
    </div>
  );
}

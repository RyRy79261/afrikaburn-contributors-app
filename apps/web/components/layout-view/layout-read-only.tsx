import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Hand, Map as MapIcon, Monitor } from "lucide-react";
import {
  boundaryDimensions,
  formatPlotSize,
  getLayoutCatalog,
  layoutObjectName,
  plotSummary,
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
            />
          </PlanViewport>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Hand className="h-4 w-4" aria-hidden />
            Pinch to zoom, drag to pan
          </p>
        </div>

        <p className="text-xs text-muted-foreground md:text-center">
          {lastEditedLine(updatedAt, updatedByName, now)}
        </p>
      </section>

      <section
        aria-label="Objects"
        className="self-start rounded-xl border border-border bg-card p-4 md:col-start-2 md:row-start-2"
      >
        <LayoutObjectList
          slug={slug}
          catalog={catalog}
          objects={child ? child.objects : doc.plot.objects}
          totalCount={child ? child.objects.length : summary.totalObjectCount}
          nestedLevel={child !== null}
        />
      </section>
    </div>
  );
}

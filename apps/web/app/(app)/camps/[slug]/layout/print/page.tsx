import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import {
  boundaryDimensions,
  findCatalogEntry,
  formatPlotSize,
  getLayoutCatalog,
  layoutObjectName,
  plotSummary,
  type LayoutCatalogEntry,
} from "@quagga/core";
import type { LayoutObject, NestedLayoutObject } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import {
  LayoutPlan,
  PLAN_TONE_CLASSES,
  PLAN_TONE_LABELS,
} from "@quagga/ui/components/layout-plan";
import { planDims, planTone } from "@quagga/ui/lib/layout-plan-model";
import { cn } from "@quagga/ui/lib/utils";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { loadCampLayout, loadLayoutAccess } from "@/lib/camp-layout-store";
import { lastEditedLine, layoutDayLabel, layoutPath } from "@/lib/layout-view";
import { PreviewNotice } from "@/components/preview-notice";
import { PrintNowButton } from "@/components/layout-view/plan-actions";

export const dynamic = "force-dynamic";

// /camps/[slug]/layout/print — the printable plan (docs/camp-layout-spec.md
// §Surfaces, decision 16): the SVG plan with rulers and a scale bar, a
// legend, and every object with its size and position, then each covered
// area on its own. For no connectivity on site: print it before you go.
//
// THE SAME AUDIENCE AS THE PLAN. Every current member may print (14 Oct
// decision); `loadLayoutAccess` turns anyone else into the camp's 404. No
// warnings — this is the read-only plan on paper.
//
// It prints on white whatever the app's theme: the sheet wears `.light`, so
// the drawing's theme colours resolve to the paper palette, and the app's
// chrome is `print:hidden`.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

type AnyObject = LayoutObject | NestedLayoutObject;

/** Metres to one decimal, always shown, with the unit. */
function metres(v: number): string {
  return `${(Math.round(v * 10) / 10).toFixed(1)} m`;
}

/** One area's objects as a table: name, kind, size, centre and rotation. */
function ObjectTable({
  objects,
  catalog,
  caption,
}: {
  objects: readonly AnyObject[];
  catalog: readonly LayoutCatalogEntry[];
  caption: string;
}) {
  if (objects.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing placed.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="py-1.5 pr-3 font-medium">
            Name
          </th>
          <th scope="col" className="py-1.5 pr-3 font-medium">
            Kind
          </th>
          <th scope="col" className="py-1.5 pr-3 font-medium">
            Size
          </th>
          <th scope="col" className="py-1.5 pr-3 font-medium">
            Centre (x, y)
          </th>
          <th scope="col" className="py-1.5 font-medium">
            Turned
          </th>
        </tr>
      </thead>
      <tbody>
        {objects.map((o) => {
          const e = findCatalogEntry(catalog, o.catalogKey);
          return (
            <tr
              key={o.id}
              className="break-inside-avoid border-b border-border/60"
            >
              <td className="py-1.5 pr-3 font-medium">
                {layoutObjectName(o, catalog)}
              </td>
              <td className="py-1.5 pr-3">{e?.label ?? o.catalogKey}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{planDims(o)}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">
                {metres(o.centre[0])}, {metres(o.centre[1])}
              </td>
              <td className="py-1.5 font-mono text-xs">
                {o.shape === "circle" ? "—" : `${Math.round(o.rotationDeg)}°`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The printable plan: the whole camp, then each covered area that holds
 * objects, with their object tables. */
export default async function CampLayoutPrintPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) return <PreviewNotice feature="Camp layout" />;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, activeEdition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!activeEdition) return <PreviewNotice feature="Camp layout" />;

  await enforceGate(viewer.id);

  const access = await loadLayoutAccess(parsed.data.slug, viewer.id);
  if (!access) notFound();
  const { camp } = access;
  const view = await loadCampLayout(access, {
    id: activeEdition.id,
    year: activeEdition.year,
  });
  const layout = view.layout;

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={layoutPath(camp.slug)}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Camp layout
      </Link>
    </Button>
  );

  if (!layout) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>{backLink}</div>
        <h1 className="text-2xl font-semibold tracking-tight">Print plan</h1>
        <p className="text-sm text-muted-foreground">
          There&apos;s no layout for {activeEdition.name} to print yet.
        </p>
      </div>
    );
  }

  const doc = layout.document;
  const catalog = getLayoutCatalog(activeEdition.year);
  const summary = plotSummary(doc, catalog);
  const now = new Date();
  const tones = [
    ...new Set(
      [
        ...doc.plot.objects,
        ...doc.plot.objects.flatMap((o) => o.child?.objects ?? []),
      ].map((o) => planTone(findCatalogEntry(catalog, o.catalogKey))),
    ),
  ];
  const covered = doc.plot.objects.filter(
    (o): o is LayoutObject & { child: NonNullable<LayoutObject["child"]> } =>
      !!o.child && o.child.objects.length > 0,
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        {backLink}
        <PrintNowButton />
      </div>

      {/* The sheet: light on screen and on paper. */}
      <article className="light flex flex-col gap-5 rounded-xl border border-border bg-background p-6 text-foreground print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-col gap-1 border-b border-border pb-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {camp.name} — camp layout
          </h1>
          <p className="text-sm">
            {activeEdition.name} · Plot {formatPlotSize(summary)} ·{" "}
            {summary.totalObjectCount}{" "}
            {summary.totalObjectCount === 1 ? "object" : "objects"}
          </p>
          <p className="text-xs text-muted-foreground">
            {lastEditedLine(layout.updatedAt, layout.updatedByName, now)} ·
            printed {layoutDayLabel(now)} · sizes in metres, measured from the
            frontage-left corner.
          </p>
        </header>

        <section
          data-plan-surface=""
          className="break-inside-avoid bg-background"
        >
          <LayoutPlan
            id="camp-layout-print"
            doc={doc}
            catalog={catalog}
            variant="full"
            title={`${camp.name}: the whole camp, drawn to scale`}
          />
        </section>

        {tones.length > 0 && (
          <section aria-label="Legend" className="break-inside-avoid">
            <h2 className="mb-2 text-sm font-semibold">Legend</h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              {tones.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-3 w-3 rounded-sm border",
                      PLAN_TONE_CLASSES[t].swatch,
                    )}
                  />
                  {PLAN_TONE_LABELS[t]}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-1 w-4 rounded bg-ab-apricot" />
                Frontage
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full border border-destructive/45 bg-destructive/10"
                />
                Safety zone
              </li>
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">On the plot</h2>
          <ObjectTable
            objects={doc.plot.objects}
            catalog={catalog}
            caption="Objects on the whole camp"
          />
        </section>

        {covered.map((o) => {
          const name = layoutObjectName(o, catalog);
          return (
            <section
              key={o.id}
              className="flex break-before-page flex-col gap-3 border-t border-border pt-4"
            >
              <h2 className="text-base font-semibold">{name} — inside</h2>
              <p className="text-xs text-muted-foreground">
                Covered area{" "}
                {formatPlotSize(boundaryDimensions(o.child.boundary))} ·
                positions measured from the covered area&apos;s own corner.
              </p>
              <div className="mx-auto w-full max-w-xl break-inside-avoid">
                <LayoutPlan
                  id={`camp-layout-print-${o.id}`}
                  doc={doc}
                  catalog={catalog}
                  areaId={o.id}
                  variant="full"
                  title={`${name}, inside, drawn to scale`}
                />
              </div>
              <ObjectTable
                objects={o.child.objects}
                catalog={catalog}
                caption={`Inside ${name}`}
              />
            </section>
          );
        })}
      </article>
    </div>
  );
}

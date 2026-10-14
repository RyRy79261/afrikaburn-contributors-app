import {
  formatPlotSize,
  getLayoutCatalog,
  layoutObjectName,
  plotSummary,
} from "@quagga/core";
import type { LayoutDocument } from "@quagga/types";
import { dimsText } from "@/lib/layout-editor-model";

// THE SEAM for the read-only plan (docs/camp-layout-spec.md §Surfaces; frame
// L3 QZeG7 / t7aOZ3). Plain members at every width, and editors below 768 px,
// land here. The read-only stage replaces this body with the server-rendered
// SVG <LayoutPlan> from @quagga/ui, the object list, Download PNG and Print;
// the props are what it needs and the page already passes them.
//
// What it shows until then is the object list and the plot size — nothing a
// member could not already see on the plan, and NEVER the warnings (editors
// only, 14 Oct decision): this component is not given them.

export interface LayoutReadOnlySeamProps {
  slug: string;
  editionName: string;
  editionYear: number;
  canEdit: boolean;
  view: {
    document: LayoutDocument;
    updatedAt: string;
    updatedByName: string | null;
  } | null;
}

export function LayoutReadOnlySeam({
  editionName,
  editionYear,
  canEdit,
  view,
}: LayoutReadOnlySeamProps) {
  if (!view) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Layout</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {canEdit
            ? `There's no layout for ${editionName} yet. Open this page on a larger screen to draw one.`
            : `Your camp's leads haven't drawn the layout for ${editionName} yet.`}
        </p>
      </section>
    );
  }
  const catalog = getLayoutCatalog(editionYear);
  const summary = plotSummary(view.document, catalog);
  return (
    <section
      aria-label="Camp layout"
      className="rounded-xl border border-border bg-card p-5"
    >
      <p className="font-mono text-sm">Plot {formatPlotSize(summary)}</p>
      <h2 className="mt-4 text-sm font-semibold">
        {summary.totalObjectCount} objects
      </h2>
      <ul className="mt-2 divide-y divide-border text-sm">
        {view.document.plot.objects.map((o) => (
          <li key={o.id} className="flex justify-between gap-3 py-2">
            <span>
              {layoutObjectName(o, catalog)}
              {o.child && o.child.objects.length > 0 && (
                <span className="block text-xs text-muted-foreground">
                  {o.child.objects.length} inside
                </span>
              )}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {dimsText(o)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

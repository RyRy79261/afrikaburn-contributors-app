import Link from "next/link";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { getLayoutCatalog } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { LayoutPlan } from "@quagga/ui/components/layout-plan";
import {
  layoutPath,
  layoutTileLine,
  type LayoutTileView,
} from "@/lib/layout-view";

// The camp page's way into Layout (docs/camp-layout-spec.md §Surfaces; frame
// QZeG7 "Other states" 1–3). Members only — the page never loads it for
// anyone else, and the plan is never public. Three states:
//
//   has a plan        a thumbnail, the plot size, the count, last edited
//   not drawn yet     members: the leads haven't drawn it; editors: draw it
//   no registration   the layout belongs to the registration; leads are
//                     sent to start that first
//
// The thumbnail is the same server-rendered SVG as the plan itself, shapes
// only. No warnings, at any rank.

/** The camp page's layout tile: a thumbnail and summary, or what to do
 * first. */
export function LayoutTile({
  slug,
  editionName,
  editionYear,
  canEdit,
  canStartRegistration,
  state,
  now,
}: {
  slug: string;
  editionName: string;
  editionYear: number;
  canEdit: boolean;
  /** Leads and co-leads: the registration is theirs to start
   * (`canViewCampRegistration`). */
  canStartRegistration: boolean;
  state: LayoutTileView;
  now: Date;
}) {
  const badge =
    state.kind === "drawn"
      ? "Members only"
      : state.kind === "not_drawn"
        ? "Not drawn yet"
        : "Needs a registration";
  const link =
    "inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-testid="layout-tile"
    >
      <div className="flex items-center justify-between gap-2">
        <LayoutGrid className="h-4 w-4 text-primary" aria-hidden />
        <Badge variant="outline">{badge}</Badge>
      </div>
      <p className="text-sm font-medium">Layout</p>

      {state.kind === "drawn" && (
        <>
          <div className="rounded-lg bg-background p-3">
            <LayoutPlan
              id="camp-layout-tile"
              doc={state.document}
              catalog={getLayoutCatalog(editionYear)}
              variant="thumb"
              title="The camp's plan, small"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {layoutTileLine(
              state.summary,
              state.updatedAt,
              state.updatedByName,
              now,
            )}
          </p>
          <Link href={layoutPath(slug)} className={`mt-auto ${link}`}>
            Open plan
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      )}

      {state.kind === "not_drawn" && (
        <>
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? `Draw your camp to scale for ${editionName}. AfrikaBurn sees the plan you send with your registration.`
              : `Your camp's leads haven't drawn the layout for ${editionName} yet.`}
          </p>
          {canEdit && (
            <Link href={layoutPath(slug)} className={`mt-auto ${link}`}>
              Draw the layout
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </>
      )}

      {state.kind === "no_registration" && (
        <>
          <p className="text-xs text-muted-foreground">
            {canStartRegistration
              ? `The layout belongs to your ${editionName} registration. Start that first.`
              : `The layout belongs to your camp's ${editionName} registration, which hasn't been started yet.`}
          </p>
          {canStartRegistration && (
            <Link
              href={`/camps/${slug}/registration`}
              className={`mt-auto ${link}`}
            >
              Start your registration
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

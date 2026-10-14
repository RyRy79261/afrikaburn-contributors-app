import Link from "next/link";
import { ChevronRight, List } from "lucide-react";
import {
  findCatalogEntry,
  layoutObjectName,
  type LayoutCatalogEntry,
} from "@quagga/core";
import type { LayoutObject, NestedLayoutObject } from "@quagga/types";
import { PLAN_TONE_CLASSES } from "@quagga/ui/components/layout-plan";
import { planDims, planTone } from "@quagga/ui/lib/layout-plan-model";
import { cn } from "@quagga/ui/lib/utils";
import { insideText, layoutPath, objectCountText } from "@/lib/layout-view";
import { ObjectListDisclosure } from "./object-list-disclosure";

// The plan's object list (frame QZeG7 "13 objects"; t7aOZ3 folded). The
// list is the plan in words: every object's name and size, and a way into
// each shade structure's covered area. It names nobody beyond the free-text
// labels the camp's editors wrote (decision 7).

type AnyObject = LayoutObject | NestedLayoutObject;

export function LayoutObjectList({
  slug,
  objects,
  catalog,
  totalCount,
  nestedLevel,
}: {
  slug: string;
  objects: readonly AnyObject[];
  catalog: readonly LayoutCatalogEntry[];
  /** The heading's count: the whole camp counts what is under its shade
   * structures too. */
  totalCount: number;
  nestedLevel: boolean;
}) {
  return (
    <ObjectListDisclosure
      summary={
        <span className="flex items-center gap-2 font-semibold">
          <List className="h-4 w-4 text-primary" aria-hidden />
          <span>{objectCountText(totalCount)}</span>
        </span>
      }
    >
      {objects.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing on the plan yet.
        </p>
      ) : (
        <ul
          aria-label="Objects on the plan"
          className="mt-3 divide-y divide-border border-t border-border text-sm"
        >
          {objects.map((o) => {
            const e = findCatalogEntry(catalog, o.catalogKey);
            const tone = PLAN_TONE_CLASSES[planTone(e)];
            const name = layoutObjectName(o, catalog);
            const child = nestedLevel ? undefined : (o as LayoutObject).child;
            const tentCount = child
              ? child.objects.filter(
                  (c) =>
                    findCatalogEntry(catalog, c.catalogKey)?.role === "tent",
                ).length
              : 0;
            const body = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 border",
                    o.shape === "circle" ? "rounded-full" : "rounded-sm",
                    tone.swatch,
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name}</span>
                  {child && (
                    <span className="block text-xs text-muted-foreground">
                      {insideText(child.objects.length, tentCount)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {planDims(o)}
                </span>
                {child && (
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
              </>
            );
            return (
              <li key={o.id}>
                {child ? (
                  <Link
                    href={layoutPath(slug, o.id)}
                    className="flex items-center gap-3 rounded-sm py-2.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="flex items-center gap-3 py-2.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ObjectListDisclosure>
  );
}

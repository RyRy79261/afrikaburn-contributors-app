"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, LayoutGrid, Pencil } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { startLayoutFromLastYearAction } from "@/app/(app)/camps/[slug]/layout/actions";

// Section 4's way into the camp layout (docs/camp-layout-spec.md §Surfaces,
// "Registration wizard, section 4"): "Draw your layout" next to the uploads,
// the "From your layout" size (decision 11), and "Start from last year's
// layout" (decision 12 — one click, a copy, never automatic). The card says
// what the layout is for and links to it; the plan itself is drawn on the
// layout page, which decides again on the server who may edit.

export interface WizardLayout {
  /** "40 m × 30 m · 1,200 m²" when a layout is drawn, else null. */
  plotSize: string | null;
  /** An earlier edition's layout to copy, offered only while none is drawn. */
  lastYear: { editionYear: number; size: string; objectCount: number } | null;
  /** The layout lives on the registration row, so a draft that has never
   * saved has nowhere to put one yet. */
  canStart: boolean;
}

/**
 * The registration wizard's layout card: the drawn plot's size and a link to
 * the editor, or the ways to start one.
 */
export function LayoutSectionCard({
  slug,
  layout,
}: {
  slug: string;
  layout: WizardLayout;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const href = `/camps/${slug}/layout`;

  /** Starts this edition's layout from last year's, then refreshes the
   * wizard. */
  const carry = () => {
    setError(null);
    startTransition(async () => {
      const r = await startLayoutFromLastYearAction({ slug });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <section
      aria-labelledby="s4-layout-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <LayoutGrid className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 id="s4-layout-heading" className="text-sm font-medium">
            Camp layout
          </h3>
          {layout.plotSize ? (
            <p className="text-sm" data-testid="s4-layout-size">
              From your layout: {layout.plotSize}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Draw your camp to scale, in metres. AfrikaBurn sees the plan you
              send with this registration, and its size answers the area
              dimensions above.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {layout.plotSize ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>
              <Pencil aria-hidden />
              Open your layout
            </Link>
          </Button>
        ) : layout.canStart ? (
          <>
            {layout.lastYear && (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={carry}
              >
                <Copy aria-hidden />
                Start from last year&apos;s layout
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={href}>
                Draw your layout
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            You can draw your layout once this draft has saved.
          </p>
        )}
      </div>
      {layout.lastYear && !layout.plotSize && layout.canStart && (
        <p className="text-xs text-muted-foreground">
          Copies your AfrikaBurn {layout.lastYear.editionYear} plan:{" "}
          {layout.lastYear.size}, {layout.lastYear.objectCount} objects.
          Nothing is copied until you choose.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

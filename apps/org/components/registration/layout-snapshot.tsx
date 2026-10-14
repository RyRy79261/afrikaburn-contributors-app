import { Lock } from "lucide-react";
import { getLayoutCatalog } from "@quagga/core";
import { LayoutPlan } from "@quagga/ui/components/layout-plan";
import type { LayoutSnapshotForReview } from "@/lib/layout-snapshot";
import { formatDate } from "@/lib/labels";

// Section 4's camp layout, as AfrikaBurn's reviewers see it (frame QZeG7
// state 5, t7aOZ3): the plan PINNED when the camp submitted, drawn by the
// same SVG renderer as the camp's own read-only view. Reviewers comment
// through the section's existing review thread — there is no review machine
// of its own here.
//
// NO WARNINGS. The frame shows a warning count on this view; the 14 Oct
// decision took it out — warnings are for the camp's editors only. Nothing
// here computes one.

const PLAN_TITLE =
  "The camp's layout as sent with the registration, drawn to scale";

export function LayoutSnapshotView({
  snapshot,
  editionYear,
}: {
  snapshot: LayoutSnapshotForReview;
  editionYear: number;
}) {
  const catalog = getLayoutCatalog(editionYear);
  return (
    <span className="flex flex-col gap-3 whitespace-normal">
      <span className="flex items-center gap-2 font-medium">
        <Lock className="h-4 w-4 text-primary" aria-hidden />
        Snapshot sent with the registration · {formatDate(snapshot.pinnedAt)}
      </span>
      <span className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Rulers and dimensions from 768 px; on a phone the compact
            drawing, whose labels stay legible at 360 (frame t7aOZ3). */}
        <span className="hidden rounded-lg border border-border bg-background p-3 md:block">
          <LayoutPlan
            id="registration-layout-snapshot"
            doc={snapshot.document}
            catalog={catalog}
            variant="full"
            title={PLAN_TITLE}
          />
        </span>
        <span className="block rounded-lg border border-border bg-background p-3 md:hidden">
          <LayoutPlan
            id="registration-layout-snapshot-compact"
            doc={snapshot.document}
            catalog={catalog}
            variant="compact"
            title={PLAN_TITLE}
          />
        </span>
        <span className="text-sm text-muted-foreground">
          Version {snapshot.version}, pinned when the camp submitted. The camp
          may have changed its plan since: you see changes when they resubmit.
        </span>
      </span>
    </span>
  );
}

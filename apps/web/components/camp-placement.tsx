import { MapPin } from "lucide-react";
import type { CampPlacement } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";

// The camp's placement for this edition — camp code and erf (epic #48). NEEDS
// DESIGN REVIEW — built from existing components without a canvas frame.
//
// Rendered for MEMBERS ONLY: the page decides with `canViewCampPlacement`
// before it loads anything, so a stranger's render never has the data to leak.
// "Placement allocated" is derived from the erf being set; it is not a status.

export function CampPlacementCard({ placement }: { placement: CampPlacement }) {
  return (
    <section
      aria-labelledby="camp-placement-heading"
      className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-4"
    >
      <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="camp-placement-heading"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            Placement
          </h2>
          {placement.placementAllocated ? (
            <Badge variant="success">Placement allocated</Badge>
          ) : (
            <Badge variant="outline">Erf not assigned yet</Badge>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Camp code</dt>
          <dd className="font-mono font-semibold">
            {placement.campCode ?? (
              <span className="font-sans font-normal text-muted-foreground">
                Not assigned yet
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Erf</dt>
          <dd className="font-mono font-semibold">
            {placement.erf ?? (
              <span className="font-sans font-normal text-muted-foreground">
                Not assigned yet
              </span>
            )}
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Assigned by AfrikaBurn Placements. An erf can change until the map is
          final — this always shows the current one. Only your camp&apos;s
          members see this.
        </p>
      </div>
    </section>
  );
}

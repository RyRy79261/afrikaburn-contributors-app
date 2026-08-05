// Org-specific badges only. Registration status is NOT one of them — that
// vocabulary lives once, in @quagga/ui's `StatusBadge`, which every org screen
// already imports. A local copy of the status → variant → label map used to sit
// here with no callers; two sources of truth for a status vocabulary the
// build-spec pins is exactly the drift worth preventing.
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { standingLabel, standingTone } from "@quagga/core";
import type { SupplierStanding } from "@quagga/types";

type Variant = BadgeProps["variant"];

export function SupplierStandingBadge({
  standing,
}: {
  standing: SupplierStanding;
}) {
  // Standing label + tone are the single source of truth in @quagga/core, so
  // the five-value vocabulary (incl. Diligent First Timer / Able & Willing To
  // Adapt) renders consistently here and in the supplier portal.
  const variant: Variant = standingTone(standing);
  return <Badge variant={variant}>{standingLabel(standing)}</Badge>;
}

export function CohortBadge({ cohort }: { cohort: "new" | "returning" }) {
  return (
    <Badge variant={cohort === "returning" ? "default" : "outline"}>
      {cohort === "returning" ? "Returning" : "New"}
    </Badge>
  );
}

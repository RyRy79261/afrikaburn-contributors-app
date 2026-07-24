import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { standingLabel, standingTone } from "@quagga/core";
import type { RegistrationStatus, SupplierStanding } from "@quagga/types";

type Variant = BadgeProps["variant"];

const REGISTRATION_STYLE: Record<
  RegistrationStatus,
  { label: string; variant: Variant }
> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "default" },
  under_review: { label: "Under review", variant: "default" },
  changes_requested: { label: "Changes requested", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
};

export function RegistrationStatusBadge({
  status,
}: {
  status: RegistrationStatus;
}) {
  const s = REGISTRATION_STYLE[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

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

import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import type { RegistrationStatus, VettingStatus } from "@quagga/types";

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

const VETTING_STYLE: Record<VettingStatus, { label: string; variant: Variant }> =
  {
    listed: { label: "Listed", variant: "outline" },
    registered: { label: "Registered", variant: "success" },
    flagged: { label: "Flagged", variant: "destructive" },
  };

export function VettingStatusBadge({ status }: { status: VettingStatus }) {
  const s = VETTING_STYLE[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function CohortBadge({ cohort }: { cohort: "new" | "returning" }) {
  return (
    <Badge variant={cohort === "returning" ? "default" : "outline"}>
      {cohort === "returning" ? "Returning" : "New"}
    </Badge>
  );
}

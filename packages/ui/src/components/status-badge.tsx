import * as React from "react";
import type { RegistrationStatus } from "@quagga/types";
import { Badge, type BadgeProps } from "./badge";

// Status badge map (canvas Badge `nn6iK` status variants) — the registration
// lifecycle → base Badge variant mapping (build-spec §UI status mapping):
// approved→success, changes_requested→warning, rejected→destructive,
// submitted/under_review→primary(default), draft→outline, withdrawn→secondary.
//
// Extensible by design: the map is a plain record, so future logistics apps can
// add their own key sets. Per product law we do NOT ship the reserved payment
// badges (PENDING PAYMENT / RECONCILED / WAIVED) here.

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Registration status → Badge variant. */
export const REGISTRATION_STATUS_VARIANT: Record<
  RegistrationStatus,
  BadgeVariant
> = {
  draft: "outline",
  submitted: "default",
  under_review: "default",
  changes_requested: "warning",
  approved: "success",
  rejected: "destructive",
  withdrawn: "secondary",
};

/** Registration status → human label (Badge uppercases via CSS). */
export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Pure lookup — the base Badge variant for a registration status. */
export function registrationStatusVariant(
  status: RegistrationStatus,
): BadgeVariant {
  return REGISTRATION_STATUS_VARIANT[status];
}

export interface StatusBadge_Props {
  status: RegistrationStatus;
  /** Override the default human label. */
  children?: React.ReactNode;
  className?: string;
}

/** A registration-status pill wired to the variant + label maps. */
export function StatusBadge({ status, children, className }: StatusBadge_Props) {
  return (
    <Badge
      variant={REGISTRATION_STATUS_VARIANT[status]}
      className={className}
    >
      {children ?? REGISTRATION_STATUS_LABEL[status]}
    </Badge>
  );
}

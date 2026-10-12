import { History, Pencil, UserMinus, UserPlus } from "lucide-react";
import { WAP_LIST_STATUS_LABELS } from "@quagga/core";
import type { WapListStatus } from "@quagga/types";
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";

// The pass list's status pill and the "since approval" chip (frames W2, W3).
// Server-safe leaves: no state, no handlers.

const LIST_VARIANT: Record<WapListStatus, BadgeProps["variant"]> = {
  draft: "outline",
  submitted: "secondary",
  approved: "success",
  returned: "warning",
};

export function WapListStatusBadge({ status }: { status: WapListStatus }) {
  return (
    <Badge variant={LIST_VARIANT[status]}>
      {WAP_LIST_STATUS_LABELS[status]}
    </Badge>
  );
}

/** "Changed since approval" (warning) or "N removed since approval" (quiet). */
export function WapSinceApprovalBadge({
  label,
  status,
}: {
  label: string;
  status: WapListStatus;
}) {
  const removed = status === "approved";
  return (
    <Badge
      variant={removed ? "outline" : "warning"}
      className="normal-case tracking-normal"
    >
      {removed ? (
        <UserMinus className="h-3 w-3" aria-hidden />
      ) : (
        <History className="h-3 w-3" aria-hidden />
      )}
      {label}
    </Badge>
  );
}

/** One line of the "since approval" list: added, removed or changed. */
export function WapChangeLine({
  kind,
  children,
}: {
  kind: "added" | "removed" | "changed";
  children: React.ReactNode;
}) {
  const Icon =
    kind === "added" ? UserPlus : kind === "removed" ? UserMinus : Pencil;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

import { DoorOpen, Lock } from "lucide-react";
import type { TeamJoinMode } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";

/** Short labels for a team's join mode, as the chips and forms say them. */
export const JOIN_MODE_LABEL: Record<TeamJoinMode, string> = {
  open: "Open",
  leads_add: "Leads add",
};

/**
 * The OPEN / LEADS ADD chip beside a team's name (frames T1, T2). `long`
 * spells out "Leads add only", as the team page header does.
 */
export function JoinModeChip({
  joinMode,
  long = false,
}: {
  joinMode: TeamJoinMode;
  long?: boolean;
}) {
  const Icon = joinMode === "open" ? DoorOpen : Lock;
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] text-foreground">
      <Icon className="h-3 w-3" aria-hidden />
      {joinMode === "leads_add" && long
        ? "Leads add only"
        : JOIN_MODE_LABEL[joinMode]}
    </Badge>
  );
}

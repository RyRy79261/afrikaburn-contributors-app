import { Users } from "lucide-react";
import { cn } from "@quagga/ui/lib/utils";
import { audienceChipLabel } from "@/lib/meeting-view";
import type { MeetingAudienceView } from "@/lib/camp-meetings-store";

/** "WHOLE CAMP" or the chosen roles' names, as an outlined chip (G1/G2). */
export function AudienceChip({
  audience,
  className,
}: {
  audience: MeetingAudienceView;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      <Users className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{audienceChipLabel(audience)}</span>
    </span>
  );
}

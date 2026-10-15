import { shiftDateLabel } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

/** The MAR / 21 / SUN block on a meeting row (frame G1). A cancelled
 * meeting's block is outlined instead of filled. */
export function MeetingDateBlock({
  date,
  muted = false,
  className,
}: {
  date: string;
  muted?: boolean;
  className?: string;
}) {
  const d = shiftDateLabel(date);
  return (
    <span
      className={cn(
        "flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-md",
        muted ? "border border-border" : "bg-secondary/60",
        className,
      )}
      aria-label={d.medium}
    >
      <span
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide",
          muted ? "text-muted-foreground" : "text-primary",
        )}
      >
        {d.month}
      </span>
      <span className="text-lg font-semibold leading-tight">{d.day}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {d.weekday}
      </span>
    </span>
  );
}

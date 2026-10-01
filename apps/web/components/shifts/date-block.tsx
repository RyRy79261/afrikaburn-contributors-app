import { shiftDateLabel } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

// The THU / 29 block on the member's shift rows (canvas S3/S4).
export function DateBlock({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  const d = shiftDateLabel(date);
  return (
    <span
      className={cn(
        "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-secondary/60",
        className,
      )}
      aria-label={d.medium}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {d.weekday}
      </span>
      <span className="text-lg font-semibold leading-tight">{d.day}</span>
    </span>
  );
}

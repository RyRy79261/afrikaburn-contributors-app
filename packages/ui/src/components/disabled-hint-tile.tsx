import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "../lib/utils";

// A deliberately-disabled dashboard tile that names a parked capability and
// says why (build-spec §apps/web `/camps/[slug]`): Containers "separate app —
// for large camps", Water/Ice/Gas "pending AfrikaBurn input", Placement & Art
// grants "entitlement — process TBC", Shifts/Budget/Layout "topics under
// exploration". Visible + honest + uncommitted — the product story.

export interface DisabledHintTileProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** The honest one-line reason it's parked. */
  hint: string;
  /** Optional decorative leading icon (defaults to a lock). */
  icon?: React.ReactNode;
  /** Optional short pill, e.g. "Separate app" or "Coming later". */
  tag?: string;
}

export function DisabledHintTile({
  title,
  hint,
  icon,
  tag,
  className,
  ...props
}: DisabledHintTileProps) {
  return (
    <div
      aria-disabled="true"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card/40 p-4 text-card-foreground opacity-70",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground" aria-hidden>
          {icon ?? <Lock className="h-4 w-4" />}
        </span>
        {tag && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {tag}
          </span>
        )}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

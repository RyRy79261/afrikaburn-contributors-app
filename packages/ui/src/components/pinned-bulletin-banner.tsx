import * as React from "react";
import { Pin, X } from "lucide-react";
import { cn } from "../lib/utils";

// PinnedBulletinBanner — the slim translucent-accent banner for a pinned
// bulletin (canvas `i3m1n`; Camp Dashboard + recipient dashboards only, never
// Landing). A single wrapping line + a "Read →" link to the full bulletin page.
//
// Server-component-safe by default: with no `onDismiss` it renders no event
// handler and holds no state. Dismissal is opt-in — pass `onDismiss` from a
// client parent to show the ✕ and own the dismissed state there.

export interface PinnedBulletinBannerProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Bulletin title / summary line (wraps freely). */
  title: React.ReactNode;
  /** Destination for the "Read →" link (the standalone bulletin page). */
  href: string;
  /** Link copy. Default "Read". */
  readLabel?: string;
  /** When provided, renders a ✕ that calls this. Omit → server-safe, no button. */
  onDismiss?: () => void;
}

export function PinnedBulletinBanner({
  title,
  href,
  readLabel = "Read",
  onDismiss,
  className,
  ...props
}: PinnedBulletinBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm",
        className,
      )}
      {...props}
    >
      <Pin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug text-foreground">{title}</p>
      <a
        href={href}
        className="shrink-0 whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {readLabel} &rarr;
      </a>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

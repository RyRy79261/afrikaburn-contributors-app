import { cn } from "@quagga/ui/lib/utils";

// Lightweight loading placeholders for the portal's app-router `loading.tsx`
// boundaries. There is no shared Skeleton in @quagga/ui yet, so these are local
// pulse blocks styled with the same `bg-muted` surface the design system already
// uses (progress track, avatars). Purely presentational — no data, no state.

function Bar({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden />
  );
}

/** A card-shaped skeleton — matches the bordered cards the portal pages render. */
function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-5">
      <Bar className="h-4 w-1/3" />
      <div className="mt-4 flex flex-col gap-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Bar
            key={i}
            className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
    </div>
  );
}

/** The page-heading block skeleton (eyebrow + title + description). */
function HeadingSkeleton() {
  return (
    <div className="mb-8 flex flex-col gap-3">
      <Bar className="h-3 w-40" />
      <Bar className="h-7 w-64" />
      <Bar className="h-3.5 w-full max-w-xl" />
    </div>
  );
}

/**
 * A full portal-page skeleton: heading plus a configurable number of card
 * blocks. Reused by the route-group loading boundary so any gated page shows a
 * consistent, on-brand loading state while its data streams in.
 */
export function PortalPageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <HeadingSkeleton />
      <div className="flex flex-col gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} lines={i === 0 ? 2 : 3} />
        ))}
      </div>
    </div>
  );
}

export { Bar as SkeletonBar, CardSkeleton };

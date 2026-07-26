import { QuiltBand } from "@quagga/ui/components/quilt-band";

// The shared loading skeleton behind the app-router `loading.tsx` boundaries.
// Server-safe (no hooks, no data) so it streams instantly while a route's data
// resolves. Echoes the page chrome — quilt band, a title bar, a grid of cards —
// with a gentle pulse, so a slow query reads as "loading", never as a broken or
// empty page. `rows`/`cards` let a route match its own shape.

interface PageSkeletonProps {
  /** How many short header lines to shimmer (title + subtitle by default). */
  rows?: number;
  /** How many card placeholders in the body grid. */
  cards?: number;
}

function Bar({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden />
  );
}

export function PageSkeleton({ rows = 2, cards = 6 }: PageSkeletonProps) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <QuiltBand />
      <div
        className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">Loading…</span>
        <div className="flex flex-col gap-3">
          <Bar className="h-7 w-52" />
          {Array.from({ length: Math.max(0, rows - 1) }).map((_, i) => (
            <Bar key={i} className="h-4 w-full max-w-prose" />
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4"
            >
              <Bar className="h-4 w-2/3" />
              <Bar className="h-3 w-full" />
              <Bar className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

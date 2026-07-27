import { QuiltBand } from "@quagga/ui/components/quilt-band";
import {
  Skeleton,
  SkeletonRegion,
  SkeletonCardGrid,
} from "@quagga/ui/components/skeleton";

// The whole-screen loading skeleton, for the surfaces that draw their OWN chrome
// rather than sitting inside `app/(app)/layout.tsx` — the landing page, the auth
// screens and the invite landing page. Everything in the `(app)` group has a
// boundary that renders inside the persistent shell instead, which is why this
// no longer belongs to those routes: replacing a header that is already on
// screen with a grey bar is a step backwards, not a loading state.
//
// Server-safe (no hooks, no data) so it streams instantly. `rows`/`cards` let a
// route match its own shape.

interface PageSkeletonProps {
  /** How many short header lines to shimmer (title + subtitle by default). */
  rows?: number;
  /** How many card placeholders in the body grid. */
  cards?: number;
}

export function PageSkeleton({ rows = 2, cards = 6 }: PageSkeletonProps) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <QuiltBand />
      <SkeletonRegion className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-52" />
          {Array.from({ length: Math.max(0, rows - 1) }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full max-w-prose" />
          ))}
        </div>
        <SkeletonCardGrid
          cards={cards}
          lines={2}
          className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        />
      </SkeletonRegion>
    </div>
  );
}

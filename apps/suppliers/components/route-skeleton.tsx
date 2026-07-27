import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

// Portal-shaped loading placeholders, composed from the shared skeleton kit in
// @quagga/ui (which is where the pulse block, card and row primitives now live —
// this file used to carry its own copies).
//
// The heading placeholder copies `PageHeading`'s container classes verbatim
// (`mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between`), so
// the real heading lands in exactly the box the skeleton held.

/** The page-heading block skeleton (eyebrow + title + description). */
export function HeadingSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      {action && <Skeleton className="h-9 w-32 shrink-0 rounded-lg" />}
    </div>
  );
}

/**
 * A full portal-page skeleton: heading plus a configurable number of card
 * blocks. Used by the route-group boundary for any gated page that has not
 * written a closer one. It renders inside `(portal)/layout.tsx`, so the sage
 * header and nav stay mounted — only the body is standing in.
 */
export function PortalPageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <SkeletonRegion>
      <HeadingSkeleton />
      <div className="flex flex-col gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} lines={i === 0 ? 2 : 3} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

export { Skeleton as SkeletonBar, SkeletonCard as CardSkeleton };

import {
  Skeleton,
  SkeletonRegion,
  SkeletonCardGrid,
} from "@quagga/ui/components/skeleton";

/**
 * /directory — heading, the search + filter row, the category chips, then the
 * camp grid.
 *
 * The container classes are copied from the page itself (`flex flex-col gap-6`,
 * heading `gap-2`, grid `sm:grid-cols-2 lg:grid-cols-3`) so the real content
 * lands in the boxes the skeleton was holding and nothing jumps.
 */
export default function DirectoryLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>

      {/* Search field + filter button */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        {["w-16", "w-24", "w-14", "w-28", "w-20"].map((w) => (
          <Skeleton key={w} className={`h-6 rounded-full ${w}`} />
        ))}
      </div>

      <SkeletonCardGrid cards={6} lines={2} />
    </SkeletonRegion>
  );
}

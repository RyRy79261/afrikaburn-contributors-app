import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/stats — the back link, title and lede, then the People card,
 * the Onboarding/Bios pair and the full-width sections, in the page's own
 * `mx-auto flex max-w-5xl flex-col gap-5` column.
 */
export default function CampStatsLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="rounded-xl border border-border bg-card/40 p-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </SkeletonRegion>
  );
}

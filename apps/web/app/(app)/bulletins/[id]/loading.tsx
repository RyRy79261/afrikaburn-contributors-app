import {
  Skeleton,
  SkeletonRegion,
  SkeletonText,
} from "@quagga/ui/components/skeleton";

/**
 * /bulletins/[id] — a single bulletin: back-link, "From AfrikaBurn" eyebrow,
 * headline, byline row, then the body prose. Article shape, not cards; the page
 * is one `mx-auto flex w-full max-w-3xl flex-col gap-5` column.
 */
export default function BulletinLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Skeleton className="h-4 w-44" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-9 w-full max-w-lg" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      <SkeletonText lines={6} />
      <SkeletonText lines={4} />
    </SkeletonRegion>
  );
}

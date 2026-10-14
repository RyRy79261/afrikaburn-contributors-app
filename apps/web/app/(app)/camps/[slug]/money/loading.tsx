import {
  Skeleton,
  SkeletonCard,
  SkeletonRegion,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/money — the back link, title and lede, the tab row, a status
 * card, the four-up figures card and the plan table, in the page's own
 * `mx-auto flex max-w-5xl flex-col gap-5` column. The members' view has the
 * same shape (a figures card, then two sections).
 */
export default function CampMoneyLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="flex gap-2 border-b border-border pb-3">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>
      <SkeletonCard lines={2} />
      <div className="rounded-xl border border-border bg-card/40 p-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
      <SkeletonCard lines={6} />
    </SkeletonRegion>
  );
}

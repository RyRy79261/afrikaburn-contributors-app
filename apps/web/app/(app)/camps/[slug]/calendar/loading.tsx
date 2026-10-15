import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/** /camps/[slug]/calendar — the header, the month switcher and legend, and
 * the six-week grid (a stack of day rows on phones). */
export default function CampCalendarLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-5">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-11 w-56" />
          <Skeleton className="hidden h-5 w-80 md:block" />
        </div>
        <div className="hidden grid-cols-7 gap-px md:grid">
          {Array.from({ length: 42 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-none" />
          ))}
        </div>
        <div className="flex flex-col gap-3 md:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

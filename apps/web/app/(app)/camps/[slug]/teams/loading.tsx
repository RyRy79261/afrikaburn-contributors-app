import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/teams — the back link, title and New team, then the team
 * rows, in the page's own `max-w-5xl` column.
 */
export default function CampTeamsLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-8 w-20 rounded-md sm:block" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

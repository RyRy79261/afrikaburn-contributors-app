import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/teams/[id] — header and actions, then About and Upcoming
 * shifts beside Team leads and Members, in the page's `max-w-5xl` column.
 */
export default function CampTeamLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-10 w-72 max-w-full rounded-md" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
            <Skeleton className="h-5 w-36" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 shrink-0 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-8 w-40 rounded-full" />
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

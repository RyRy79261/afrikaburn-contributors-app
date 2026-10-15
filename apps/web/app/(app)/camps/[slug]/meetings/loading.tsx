import {
  Skeleton,
  SkeletonRegion,
  SkeletonRow,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/meetings — the back link, title and actions, then the
 * Upcoming card's rows, in the page's own `max-w-5xl` column.
 */
export default function CampMeetingsLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card/40 p-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <div className="mt-5 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} columns={3} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

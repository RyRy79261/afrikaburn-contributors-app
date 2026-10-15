import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/** /camps/[slug]/meetings/new and /[id]/edit — the back link, the title and
 * the form card in the page's `max-w-3xl` column. */
export default function MeetingFormLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-card/40 p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>
    </SkeletonRegion>
  );
}

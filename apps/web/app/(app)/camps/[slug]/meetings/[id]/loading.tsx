import {
  Skeleton,
  SkeletonCard,
  SkeletonRegion,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/meetings/[id] — the back link and title, the When / Where /
 * Call card, then the agenda and notes beside "Who came".
 */
export default function MeetingLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="grid gap-5 rounded-xl border border-border bg-card/40 p-5 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
        <SkeletonCard lines={6} />
      </div>
    </SkeletonRegion>
  );
}

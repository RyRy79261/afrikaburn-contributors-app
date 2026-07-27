import { SkeletonRegion, Skeleton } from "@quagga/ui/components/skeleton";
import { HeadingSkeleton } from "@/components/route-skeleton";

/**
 * /notifications — the portal inbox: filter chips, then day-grouped rows. A
 * list, so rows rather than cards; a grid here would reflow on arrival.
 */
export default function SupplierNotificationsLoading() {
  return (
    <SkeletonRegion>
      <HeadingSkeleton />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="flex flex-col gap-6">
        {[0, 1].map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <div className="rounded-xl border border-border bg-card/40 p-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-4">
                  <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkeletonRegion>
  );
}

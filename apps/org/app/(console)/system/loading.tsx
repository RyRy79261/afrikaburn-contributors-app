import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * /system — a summary line, then two cards of checks, then the access roster.
 *
 * This page makes a real database round trip before it can render, so the
 * skeleton is doing genuine work rather than flickering: when the database is
 * the slow thing, this is what stands in for the answer.
 */
export default function SystemLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton action />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-full rounded-lg" />
        {[6, 5].map((rows, card) => (
          <div key={card} className="rounded-xl border bg-card p-6 shadow-sm">
            <Skeleton className="mb-2 h-5 w-40" />
            <Skeleton className="mb-6 h-4 w-full max-w-xl" />
            <div className="flex flex-col gap-5">
              {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

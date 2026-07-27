import {
  SkeletonRegion,
  Skeleton,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";
import { HeadingSkeleton } from "@/components/route-skeleton";

/**
 * /standing — the heading, then the standing "hero" card (icon, verdict, badge)
 * and the supporting cards. The hero is reproduced at its real height so the
 * verdict does not jump into place when it arrives.
 */
export default function StandingLoading() {
  return (
    <SkeletonRegion>
      <HeadingSkeleton />
      <div className="rounded-xl border border-border bg-card/40 p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3.5 w-56" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <SkeletonCard lines={3} />
      </div>
    </SkeletonRegion>
  );
}

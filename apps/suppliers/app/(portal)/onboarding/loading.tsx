import {
  SkeletonRegion,
  Skeleton,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";
import { HeadingSkeleton } from "@/components/route-skeleton";

/**
 * /onboarding — the seven-step Supplier Depot checklist: heading, the progress
 * card (step count + supplier-code chip + track), then the step rows.
 */
export default function SupplierOnboardingLoading() {
  return (
    <SkeletonRegion>
      <HeadingSkeleton />
      <div className="mb-6 rounded-xl border border-border bg-card/40 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

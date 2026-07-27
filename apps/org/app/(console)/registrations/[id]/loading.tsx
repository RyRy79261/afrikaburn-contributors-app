import { SkeletonRegion, SkeletonCard } from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * /registrations/[id] — one camp's submission: the six sections down the main
 * column with the decision panel beside it. The heaviest read in the console, so
 * it gets its own boundary rather than the generic one.
 */
export default function RegistrationDetailLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton action />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

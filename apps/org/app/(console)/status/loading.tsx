import { SkeletonRegion, SkeletonCard } from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * /status — the board: two-thirds of cards on the left, the summary rail on the
 * right (`grid gap-4 lg:grid-cols-3` with a `lg:col-span-2`), matching the page.
 */
export default function StatusLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <ConsoleHeadingSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

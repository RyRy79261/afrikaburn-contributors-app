import { SkeletonRegion } from "@quagga/ui/components/skeleton";
import {
  ConsoleHeadingSkeleton,
  ConsoleTableSkeleton,
} from "@/components/console-skeleton";

/** /safety — heading, the status tabs, then the report rows. */
export default function SafetyLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <ConsoleHeadingSkeleton />
      <ConsoleTableSkeleton rows={6} columns={3} filters={false} />
    </SkeletonRegion>
  );
}

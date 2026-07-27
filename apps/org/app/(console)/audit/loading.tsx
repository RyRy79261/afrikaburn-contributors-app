import { SkeletonRegion, SkeletonCard } from "@quagga/ui/components/skeleton";
import {
  ConsoleHeadingSkeleton,
  ConsoleTableSkeleton,
} from "@/components/console-skeleton";

/**
 * /audit — the explanatory card about what the log is for, then the event table.
 * Page container is `flex flex-col gap-6`, matched here.
 */
export default function AuditLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <ConsoleHeadingSkeleton />
      <SkeletonCard lines={2} />
      <ConsoleTableSkeleton rows={10} columns={5} filters={false} />
    </SkeletonRegion>
  );
}

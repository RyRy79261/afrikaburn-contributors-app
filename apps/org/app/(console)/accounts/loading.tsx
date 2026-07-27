import { SkeletonRegion } from "@quagga/ui/components/skeleton";
import {
  ConsoleHeadingSkeleton,
  ConsoleTableSkeleton,
} from "@/components/console-skeleton";

/** /accounts — search box over the people table. */
export default function AccountsLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton />
      <ConsoleTableSkeleton rows={10} columns={4} />
    </SkeletonRegion>
  );
}

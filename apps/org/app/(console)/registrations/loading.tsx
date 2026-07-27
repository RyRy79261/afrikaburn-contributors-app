import { SkeletonRegion } from "@quagga/ui/components/skeleton";
import {
  ConsoleHeadingSkeleton,
  ConsoleTableSkeleton,
} from "@/components/console-skeleton";

/**
 * /registrations — the review queue. Heading, the status / sound / cohort filter
 * strip, then a page of 15 rows in the responsive-table surface.
 */
export default function RegistrationsLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton />
      <ConsoleTableSkeleton rows={10} columns={5} />
    </SkeletonRegion>
  );
}

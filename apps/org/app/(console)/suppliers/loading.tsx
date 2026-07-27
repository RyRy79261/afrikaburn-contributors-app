import { SkeletonRegion } from "@quagga/ui/components/skeleton";
import {
  ConsoleHeadingSkeleton,
  ConsoleTableSkeleton,
} from "@/components/console-skeleton";

/** /suppliers (and sign-up management below it) — the supplier table. */
export default function SuppliersLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton action />
      <ConsoleTableSkeleton rows={10} columns={5} />
    </SkeletonRegion>
  );
}

import {
  SkeletonRegion,
  SkeletonCard,
  Skeleton,
} from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/** /categories — the taxonomy manager: an explanatory note over the category list. */
export default function CategoriesLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <SkeletonCard lines={4} />
      </div>
    </SkeletonRegion>
  );
}

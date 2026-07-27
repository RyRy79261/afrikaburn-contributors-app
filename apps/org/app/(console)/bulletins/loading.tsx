import {
  SkeletonRegion,
  SkeletonCard,
  Skeleton,
} from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * /bulletins — published and draft sections, each a `flex flex-col gap-3` list
 * of bulletin cards under a mono section label.
 */
export default function BulletinsLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton action />
      <div className="flex flex-col gap-8">
        {[0, 1].map((section) => (
          <section key={section} className="flex flex-col gap-3">
            <Skeleton className="h-3 w-28" />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </section>
        ))}
      </div>
    </SkeletonRegion>
  );
}

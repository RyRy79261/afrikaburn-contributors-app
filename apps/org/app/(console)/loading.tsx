import {
  SkeletonRegion,
  SkeletonCardGrid,
} from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * The console's default loading boundary — the Overview page and anything below
 * that has not written a closer one.
 *
 * It renders INSIDE `layout.tsx`, so the ochre header, the session badge and the
 * eight-item nav are already on screen and stay mounted; only the page body is
 * standing in. That is also what makes prefetch pay: `<Link>` prefetches a
 * dynamic route down to its nearest loading boundary, so this markup is usually
 * already in the browser before the nav item is clicked.
 */
export default function ConsoleLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton />
      <SkeletonCardGrid
        cards={6}
        lines={1}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      />
    </SkeletonRegion>
  );
}

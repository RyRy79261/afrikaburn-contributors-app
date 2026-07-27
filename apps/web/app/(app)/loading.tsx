import {
  SkeletonRegion,
  SkeletonHeading,
  SkeletonCardGrid,
} from "@quagga/ui/components/skeleton";

/**
 * The group's default loading boundary — used by any route inside `(app)` that
 * has not written a closer one.
 *
 * It renders INSIDE `layout.tsx`, so the header, nav and edition banner are
 * already on screen and stay put; only the body is standing in. That is also
 * what makes prefetching pay: for a dynamic route, `<Link>` prefetches down to
 * the nearest loading boundary, so by the time a nav link is clicked this
 * markup is usually already in the browser and paints with no network at all.
 *
 * No fixed container of its own — the layout already supplies
 * `mx-auto w-full max-w-5xl px-6 py-8`, exactly as it does for the real page.
 */
export default function AppGroupLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <SkeletonHeading eyebrow={false} />
      <SkeletonCardGrid cards={6} lines={2} />
    </SkeletonRegion>
  );
}

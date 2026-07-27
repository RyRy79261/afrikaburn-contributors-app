import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/registration — the six-section workspace. Mirrors the page's own
 * header (`mb-6 flex flex-col gap-2`: back-link, edition eyebrow, camp name)
 * and then the section list, because both the editable wizard and the read-only
 * summary render as a stack of section cards.
 */
export default function RegistrationLoading() {
  return (
    <SkeletonRegion>
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-8 w-64 max-w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    </SkeletonRegion>
  );
}

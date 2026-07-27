import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/settings/* — the roles & officers surface is the only one so
 * far. Single `mx-auto max-w-3xl` column: back button, breadcrumb, title, blurb,
 * then the role cards.
 */
export default function CampSettingsLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Skeleton className="mb-2 h-8 w-40 rounded-lg" />
        <Skeleton className="h-3 w-64 max-w-full" />
        <Skeleton className="mt-2 h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-prose" />
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={4} />
    </SkeletonRegion>
  );
}

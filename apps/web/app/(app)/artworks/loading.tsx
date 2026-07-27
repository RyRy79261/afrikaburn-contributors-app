import {
  Skeleton,
  SkeletonRegion,
  SkeletonForm,
} from "@quagga/ui/components/skeleton";

/**
 * /artworks/new and /artworks/[slug]/edit — the kind-specific registration form.
 * Both render a single `mx-auto max-w-3xl` column: back-link, heading block,
 * then the form.
 */
export default function ArtworksLoading() {
  return (
    <SkeletonRegion className="mx-auto max-w-3xl">
      <Skeleton className="mb-4 h-4 w-36" />
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <SkeletonForm fields={5} />
    </SkeletonRegion>
  );
}

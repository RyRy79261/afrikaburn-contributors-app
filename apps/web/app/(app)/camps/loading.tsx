import {
  Skeleton,
  SkeletonRegion,
  SkeletonForm,
} from "@quagga/ui/components/skeleton";

/**
 * Fallback for the camp segment. In practice this is `/camps/new` — the camp
 * dashboard and the registration workspace each have their own closer boundary.
 * A single narrow column (`mx-auto max-w-xl`), back-link, heading, and the form,
 * matching the create page's own containers.
 */
export default function CampsLoading() {
  return (
    <SkeletonRegion className="mx-auto max-w-xl">
      <Skeleton className="mb-4 h-4 w-36" />
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <SkeletonForm fields={4} />
    </SkeletonRegion>
  );
}

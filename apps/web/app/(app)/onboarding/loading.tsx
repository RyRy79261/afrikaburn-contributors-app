import {
  Skeleton,
  SkeletonRegion,
  SkeletonForm,
} from "@quagga/ui/components/skeleton";

/**
 * /onboarding — the Burner Bio flow. Narrow `mx-auto max-w-2xl` column with the
 * page's own `mb-6` heading block over the step card.
 */
export default function OnboardingLoading() {
  return (
    <SkeletonRegion className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <SkeletonForm fields={3} />
    </SkeletonRegion>
  );
}

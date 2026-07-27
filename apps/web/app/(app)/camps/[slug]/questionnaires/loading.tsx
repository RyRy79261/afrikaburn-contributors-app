import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug]/questionnaires (and the fill / new views below it) — breadcrumb
 * eyebrow, title, and the list of questionnaire cards, in the page's own
 * `flex flex-col gap-6` / `gap-3` containers.
 */
export default function CampQuestionnairesLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </SkeletonRegion>
  );
}

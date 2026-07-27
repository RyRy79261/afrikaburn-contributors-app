import {
  Skeleton,
  SkeletonRegion,
  SkeletonForm,
} from "@quagga/ui/components/skeleton";

/**
 * /questionnaires/[activationId] — the fill view. Title block over the question
 * form; a blocking questionnaire is the only thing on screen, so the skeleton
 * says so too rather than implying a page full of other content.
 */
export default function QuestionnaireLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <SkeletonForm fields={4} />
    </SkeletonRegion>
  );
}

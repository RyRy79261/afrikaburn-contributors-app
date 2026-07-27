import {
  SkeletonRegion,
  SkeletonCard,
  Skeleton,
} from "@quagga/ui/components/skeleton";
import { ConsoleHeadingSkeleton } from "@/components/console-skeleton";

/**
 * /questionnaires — the templates grouped by audience (participants, suppliers,
 * org-internal), each an icon-labelled section over its cards.
 */
export default function QuestionnairesLoading() {
  return (
    <SkeletonRegion>
      <ConsoleHeadingSkeleton action />
      <div className="flex flex-col gap-8">
        {[0, 1, 2].map((section) => (
          <section key={section} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <SkeletonCard lines={2} />
          </section>
        ))}
      </div>
    </SkeletonRegion>
  );
}

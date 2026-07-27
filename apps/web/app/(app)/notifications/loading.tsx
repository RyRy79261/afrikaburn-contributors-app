import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/**
 * /notifications — the inbox column (`max-w-3xl`, `gap-7`): eyebrow + title +
 * blurb, the filter tabs and "Mark all read" row, then day-grouped rows.
 *
 * Rows, not cards: the inbox is a list, and a grid of card placeholders would
 * be a lie that reflows the moment the real rows arrive.
 */
export default function NotificationsLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-3xl flex-col gap-7">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      <div className="flex flex-col gap-5">
        {["Today", "Earlier"].map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-4"
              >
                <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

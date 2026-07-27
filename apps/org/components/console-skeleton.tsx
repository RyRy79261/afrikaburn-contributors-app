import { Skeleton } from "@quagga/ui/components/skeleton";

/**
 * The console's own loading vocabulary, on top of `@quagga/ui`'s skeleton kit.
 *
 * Every console page opens with `PageHeading`, so the heading placeholder here
 * copies that component's container classes verbatim (`mb-6 flex flex-col gap-3
 * sm:flex-row sm:items-end sm:justify-between`). When the real heading arrives it
 * occupies exactly the box the skeleton held, so nothing below it moves.
 *
 * These render inside `(console)/layout.tsx`, which keeps the ochre header and
 * nav mounted across navigations — the skeleton is only ever standing in for the
 * page body.
 */
export function ConsoleHeadingSkeleton({
  eyebrow = true,
  description = true,
  action = false,
}: {
  eyebrow?: boolean;
  description?: boolean;
  action?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        {eyebrow && <Skeleton className="h-3 w-32" />}
        <Skeleton className="h-8 w-56" />
        {description && <Skeleton className="h-4 w-full max-w-2xl" />}
      </div>
      {action && <Skeleton className="h-9 w-36 shrink-0 rounded-lg" />}
    </div>
  );
}

/**
 * The table body every list page renders: a filter strip, then rows inside the
 * `md:rounded-xl md:border` surface the responsive data table uses. Row count
 * defaults to a page of results so the scroll height is roughly right.
 */
export function ConsoleTableSkeleton({
  rows = 8,
  columns = 5,
  filters = true,
}: {
  rows?: number;
  columns?: number;
  filters?: boolean;
}) {
  return (
    <>
      {filters && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      )}
      <div className="md:rounded-xl md:border md:bg-card md:shadow-sm">
        <div className="flex flex-col gap-4 p-5">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              {Array.from({ length: Math.max(0, columns - 1) }).map((_, c) => (
                <Skeleton
                  key={c}
                  className={c % 2 === 0 ? "h-4 w-24" : "h-4 w-16"}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

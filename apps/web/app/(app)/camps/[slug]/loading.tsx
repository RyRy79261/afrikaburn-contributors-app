import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
  SkeletonRow,
} from "@quagga/ui/components/skeleton";

/**
 * /camps/[slug] — the camp dashboard, and by some distance the slowest page in
 * the app: roster, invites, roles, assignments, officer status, permissions,
 * pending questionnaires and pinned bulletins are all per-viewer reads.
 *
 * So this is the boundary that matters most. It reproduces the real page's
 * skeleton exactly: `flex flex-col gap-6`, the kind/status header, then the
 * `grid gap-6 lg:grid-cols-3` split — members occupying `lg:col-span-2` with the
 * registration and invite cards beside it.
 */
export default function CampLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/40 p-5 lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-3 w-56" />
          <div className="mt-5 flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} columns={3} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </SkeletonRegion>
  );
}

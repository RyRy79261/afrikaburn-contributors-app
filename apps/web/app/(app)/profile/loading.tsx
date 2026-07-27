import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /profile — the page is a single `max-w-2xl` column: title block, the avatar +
 * name identity row, then the bio sections. Same container classes as the page
 * (`mx-auto flex max-w-2xl flex-col gap-6`), so the swap is a fill.
 */
export default function ProfileLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-full max-w-prose" />
      </div>

      {/* Identity row: avatar, handle, home city */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>

      <SkeletonCard lines={5} />
      <SkeletonCard lines={4} />
    </SkeletonRegion>
  );
}

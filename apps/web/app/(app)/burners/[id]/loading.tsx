import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /burners/[id] — a burner's public profile: the hero (avatar, name, home city,
 * burn count) then the disclosed sections. Same `mx-auto flex max-w-3xl
 * flex-col gap-5` column the page uses.
 */
export default function BurnerLoading() {
  return (
    <SkeletonRegion className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card/40 p-5">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </SkeletonRegion>
  );
}

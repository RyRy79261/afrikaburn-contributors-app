import {
  Skeleton,
  SkeletonRegion,
  SkeletonCard,
} from "@quagga/ui/components/skeleton";

/**
 * /account, /account/security, /account/delete — all three render through
 * `AccountShell`, so this mirrors it: the "YOUR ACCOUNT" eyebrow, the title, the
 * description, the three-way section nav, then the section's cards.
 *
 * The nav pill row is reproduced at its real size (`h-9` inside a `bg-muted p-1`
 * strip) because it is the one thing on this page that does NOT change between
 * the three tabs — a skeleton that dropped it would make every tab switch look
 * like the whole page had gone away.
 */
export default function AccountLoading() {
  return (
    <SkeletonRegion className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="inline-flex w-fit items-center gap-1 rounded-md bg-muted p-1">
          <Skeleton className="h-7 w-20 rounded-sm" />
          <Skeleton className="h-7 w-20 rounded-sm" />
          <Skeleton className="h-7 w-16 rounded-sm" />
        </div>
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>

      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </SkeletonRegion>
  );
}

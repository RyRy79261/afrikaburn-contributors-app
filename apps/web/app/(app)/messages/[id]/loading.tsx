import { Skeleton, SkeletonRegion } from "@quagga/ui/components/skeleton";

/** /messages/[id] — header, timer row, a few message bubbles, composer. */
export default function ConversationLoading() {
  return (
    <SkeletonRegion className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
        <Skeleton className="h-12 w-3/5 rounded-2xl" />
      </div>
      <Skeleton className="h-24 w-full rounded-md" />
    </SkeletonRegion>
  );
}

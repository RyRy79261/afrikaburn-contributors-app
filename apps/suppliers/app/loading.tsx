import { SkeletonBar, CardSkeleton } from "@/components/route-skeleton";

// Root loading boundary — shown while the landing page resolves its session
// (the page is force-dynamic, so this covers the cookie read + any redirect
// decision). Mirrors the landing page's header + card-grid shape.

export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-10 px-6 py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-4">
        <SkeletonBar className="h-3 w-52" />
        <SkeletonBar className="h-10 w-72" />
        <SkeletonBar className="h-3.5 w-full max-w-2xl" />
        <SkeletonBar className="h-3.5 w-2/3 max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    </main>
  );
}

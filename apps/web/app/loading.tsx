import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Root loading boundary — now only for the routes that draw their own chrome:
// the landing page, `/auth/*` and `/join/*`. Everything in the `(app)` group has
// a boundary inside the persistent shell (`app/(app)/loading.tsx` and its
// per-route siblings), so a navigation between signed-in pages never blanks the
// header again.
export default function RootLoading() {
  return <PageSkeleton rows={2} cards={3} />;
}

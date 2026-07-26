import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Root loading boundary: shown while any route segment without its own
// `loading.tsx` resolves its data. A branded skeleton, not a blank frame.
export default function RootLoading() {
  return <PageSkeleton />;
}

import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Loading skeleton for the camp surfaces.
export default function CampsLoading() {
  return <PageSkeleton rows={2} cards={4} />;
}

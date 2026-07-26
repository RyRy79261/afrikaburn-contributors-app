import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Loading skeleton for the directory — the grid of camp cards.
export default function DirectoryLoading() {
  return <PageSkeleton rows={2} cards={6} />;
}

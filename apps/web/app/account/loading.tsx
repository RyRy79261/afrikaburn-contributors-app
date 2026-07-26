import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Loading skeleton for the account + security surfaces.
export default function AccountLoading() {
  return <PageSkeleton rows={2} cards={3} />;
}

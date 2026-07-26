import { PageSkeleton } from "@/components/boundary/page-skeleton";

// Loading skeleton for the notifications inbox.
export default function NotificationsLoading() {
  return <PageSkeleton rows={2} cards={4} />;
}

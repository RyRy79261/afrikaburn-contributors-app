"use client";

import { ErrorRecovery } from "@/components/boundary/error-recovery";

// Root error boundary: catches any unhandled render/query failure in a route
// segment that has no closer boundary, and shows the calm branded recovery panel
// instead of a Next.js crash page.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} />;
}

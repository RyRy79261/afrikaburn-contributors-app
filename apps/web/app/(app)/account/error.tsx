"use client";

import { ErrorRecovery } from "@/components/boundary/error-recovery";

// Boundary for the account + security surfaces.
export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorRecovery
      frame="inline"
      error={error}
      reset={reset}
      title="We couldn't load your account"
      description="Something went wrong loading your account settings. Try again — nothing was changed."
    />
  );
}

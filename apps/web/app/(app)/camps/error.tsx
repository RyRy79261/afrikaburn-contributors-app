"use client";

import { ErrorRecovery } from "@/components/boundary/error-recovery";

// Boundary for the camp surfaces (dashboard, registration wizard, questionnaires,
// roles settings) — the most query-heavy routes in the app.
export default function CampsError({
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
      title="We couldn't load that camp"
      description="Something went wrong fetching this camp's data. Try again — your work isn't lost."
    />
  );
}

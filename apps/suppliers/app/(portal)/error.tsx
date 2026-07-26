"use client";

// Error boundary for the gated portal (onboarding / standing / notifications).
// This is where a live query failure is most likely to surface, since these
// pages read the DB after the gate. It renders inside the portal shell's content
// area — the header/nav stay put — with a retry that re-runs just this segment.

import { useEffect } from "react";
import { ErrorRecovery } from "@/components/error-recovery";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[suppliers] portal route error", error);
  }, [error]);

  return (
    <ErrorRecovery
      reset={reset}
      digest={error.digest}
      description="We couldn't load your portal data just now. This is usually temporary — try again in a moment."
      homeHref="/onboarding"
      homeLabel="Back to onboarding"
    />
  );
}

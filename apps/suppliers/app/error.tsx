"use client";

// Root error boundary for the supplier portal. Catches any unhandled error
// thrown while rendering a page under the root layout (landing, auth, and — via
// its own nested boundary — the portal). Renders the calm, sage-accented
// recovery surface with a working "Try again" instead of Next's crash page.

import { useEffect } from "react";
import { ErrorRecovery } from "@/components/error-recovery";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server logs / observability; never to the supplier.
    console.error("[suppliers] unhandled route error", error);
  }, [error]);

  return (
    <ErrorRecovery
      reset={reset}
      digest={error.digest}
      homeHref="/"
      homeLabel="Back to start"
    />
  );
}

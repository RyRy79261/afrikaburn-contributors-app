"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";

// Root error boundary for the console. Catches anything the console LAYOUT (or
// a page rendered above the finer (console)/error.tsx boundary) throws — an
// unhandled query failure while resolving the session, a gate lookup that blew
// up — and renders a calm, branded recovery instead of Next's crash page. The
// full-width QuiltBand + apricot `.org-accent` skin come from the root layout,
// which still wraps this, so it stays a plain centred column.

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error to logs/observability; the UI stays reassuring.
    console.error("[org] unhandled route error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <TriangleAlert className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          AfrikaBurn Organiser Console
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground">
          The console hit an unexpected error. Nothing you were doing was lost —
          try again, and if it keeps happening let the tech team know.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center">
        <Button onClick={reset} size="lg">
          <RotateCw aria-hidden />
          Try again
        </Button>
      </div>
    </main>
  );
}

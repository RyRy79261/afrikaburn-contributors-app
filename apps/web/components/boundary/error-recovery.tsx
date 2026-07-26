"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { QuiltBand } from "@quagga/ui/components/quilt-band";

// The shared recovery UI behind every app-router `error.tsx`. A calm, branded
// "something went wrong — try again" panel with a retry, NOT a raw Next.js crash
// page. Client component (error boundaries must be): it receives Next's `reset`
// to re-render the failed segment, and logs the error to the console for triage.

export interface ErrorRecoveryProps {
  /** The error Next.js caught (carries an optional `digest` for server errors). */
  error: Error & { digest?: string };
  /** Re-attempt rendering the failed route segment. */
  reset: () => void;
  /** Optional override headline (defaults to a generic, reassuring line). */
  title?: string;
  /** Optional supporting sentence. */
  description?: string;
}

export function ErrorRecovery({
  error,
  reset,
  title = "Something went wrong",
  description = "This one's on us, not you. Give it another try — if it keeps happening, an organiser can help.",
}: ErrorRecoveryProps) {
  React.useEffect(() => {
    // Surface the failure for logs/telemetry without ever showing a stack to the
    // participant.
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <QuiltBand />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          {error.digest && (
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
              Ref {error.digest}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to start</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

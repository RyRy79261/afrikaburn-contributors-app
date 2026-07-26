"use client";

import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";

/**
 * The portal's calm, branded recovery surface. Rendered by every app-router
 * `error.tsx` boundary so an unhandled query failure reads as "something went
 * wrong — try again" rather than a raw Next.js crash page. `reset()` re-runs the
 * failed segment; the home link is the always-available escape hatch.
 *
 * Deliberately shows no error internals — a supplier never needs the stack, and
 * surfacing DB messages would be a leak. The digest is kept for support only.
 */
export function ErrorRecovery({
  reset,
  digest,
  title = "Something went wrong",
  description = "We couldn't load this part of the portal. This is usually temporary — try again in a moment.",
  homeHref = "/onboarding",
  homeLabel = "Back to onboarding",
}: {
  reset?: () => void;
  digest?: string;
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {reset && (
          <Button onClick={reset} size="lg">
            <RotateCw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
        )}
        <Button asChild variant="outline" size="lg">
          <Link href={homeHref}>{homeLabel}</Link>
        </Button>
      </div>
      {digest && (
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground/70">
          Ref: {digest}
        </p>
      )}
    </main>
  );
}

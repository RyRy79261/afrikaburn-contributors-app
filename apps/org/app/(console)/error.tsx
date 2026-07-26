"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";

// Page-level error boundary for the console route group. It sits BELOW the
// console layout, so when a single page's query fails the header + nav stay put
// and only the content area shows this calm recovery — the reviewer can retry
// or move to another section without a full-page crash.

export default function ConsolePageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[org] console page error", error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <TriangleAlert className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">
            This page didn&apos;t load
          </h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Something went wrong fetching this section. Try again — the rest of
            the console is still working.
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          )}
        </div>
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

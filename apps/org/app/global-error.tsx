"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import "@quagga/ui/styles.css";

// Last-resort boundary. `error.tsx` renders INSIDE the root layout, so it can't
// catch an error thrown by the root layout itself; `global-error.tsx` replaces
// the whole document when that happens and must therefore render its own
// <html>/<body>. It carries the dark `.org-accent` skin and the stylesheet so
// the recovery still looks like the console rather than an unstyled crash.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[org] fatal application error", error);
  }, [error]);

  return (
    <html lang="en" className="dark org-accent">
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
              <TriangleAlert className="h-5 w-5" aria-hidden />
            </span>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              AfrikaBurn Organiser Console
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              The console couldn&apos;t start
            </h1>
            <p className="text-sm text-muted-foreground">
              A fatal error stopped the page from loading. Try again — if it
              persists, let the tech team know.
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
      </body>
    </html>
  );
}

"use client";

// Last-resort boundary: replaces the ROOT layout when the layout itself throws,
// so it must ship its own <html>/<body> and pull in the design tokens (the root
// layout that normally does this is exactly what failed). Kept dependency-free
// and self-contained — a plain anchor, not next/link, because the router may be
// compromised at this point. Ordinary page errors are handled by app/error.tsx.

import { useEffect } from "react";
import "@quagga/ui/styles.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[suppliers] fatal layout error", error);
  }, [error]);

  return (
    <html lang="en" className="dark supplier-accent">
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            AfrikaBurn · Supplier Portal
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            The portal hit an unexpected error. Try again, and if it keeps
            happening, email suppliers@afrikaburn.com.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
            <a
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-md border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back to start
            </a>
          </div>
          {error.digest && (
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              Ref: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

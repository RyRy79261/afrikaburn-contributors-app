import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { QuiltBand } from "@quagga/ui/components/quilt-band";

// The shared branded 404 behind the app-router `not-found.tsx` boundaries — for
// a bad URL, a camp slug that doesn't exist, or a `notFound()` call. Server-safe
// and honest: it never implies the thing existed and vanished, and always offers
// a way back into the app rather than a dead end.

export interface NotFoundViewProps {
  title?: string;
  description?: string;
}

export function NotFoundView({
  title = "We couldn't find that",
  description = "The page or camp you're after doesn't exist, or was never registered. It may have moved, or the link might be off.",
}: NotFoundViewProps) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <QuiltBand />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
            404
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link href="/directory">
                <Compass className="h-4 w-4" aria-hidden />
                Browse the directory
              </Link>
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

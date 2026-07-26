import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@quagga/ui/components/button";

// Root not-found boundary. Renders for an unmatched URL and for any page that
// calls `notFound()` — a registration / bulletin / questionnaire that no longer
// exists (or was never real). Rendered inside the root layout, so the QuiltBand
// and apricot skin are already present; this stays a plain centred column.

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Compass className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          AfrikaBurn Organiser Console
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          We couldn&apos;t find that
        </h1>
        <p className="text-sm text-muted-foreground">
          The page you were after doesn&apos;t exist, or the thing it pointed to
          has since been removed.
        </p>
      </div>

      <div className="flex items-center justify-center">
        <Button asChild size="lg">
          <Link href="/">Back to the console</Link>
        </Button>
      </div>
    </main>
  );
}

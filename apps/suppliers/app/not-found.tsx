import Link from "next/link";
import { Compass, PackageOpen } from "lucide-react";
import { Button } from "@quagga/ui/components/button";

// Root 404 for the supplier portal. Reached by an unknown URL or an explicit
// `notFound()`. Branded and calm — never a bare Next.js 404 — with a clear way
// back to the portal.

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Compass className="h-5 w-5" aria-hidden />
      </span>
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
        AfrikaBurn · Supplier Portal
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="text-sm text-muted-foreground">
          That page doesn&apos;t exist, or it may have moved. Everything the
          portal offers is one step away from your onboarding checklist.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/onboarding">
            <PackageOpen className="h-4 w-4" aria-hidden />
            Go to onboarding
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/">Back to start</Link>
        </Button>
      </div>
    </main>
  );
}

import type { ReactNode } from "react";
import { PackageOpen } from "lucide-react";
import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";

// Shared chrome for the portal's two branded auth screens (canvas `K3zNk`
// sign-up / `OX6KJ` sign-in, mobile `h83pUG` / `xgCd7`): full-width quilt edge,
// the sage "SUPPLIER PORTAL" kicker, a single card, and the edition footer.
//
// Presentational and hook-free so it stays a server component — the forms it
// wraps are the only client boundary on these routes.

export function AuthShell({
  editionLabel,
  children,
}: {
  editionLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Full-width quilt edge (identity motif, edge-to-edge). */}
      <QuiltBand />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
            <PackageOpen className="h-5 w-5" aria-hidden />
          </span>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            Supplier Portal
          </p>
        </div>

        <NotConfiguredBanner />

        <Card className="overflow-hidden">
          <CardContent className="p-6">{children}</CardContent>
        </Card>

        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {editionLabel}
        </p>
      </main>
    </div>
  );
}

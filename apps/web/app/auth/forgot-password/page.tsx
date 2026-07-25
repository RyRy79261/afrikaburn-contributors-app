import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { ForgotPasswordForm } from "@/components/account/forgot-password-form";
import { getEditionLabel } from "@/lib/edition";

// /auth/forgot-password (canvas frames Gf1iJ + s2PAS, panel ①).
//
// A STATIC route deliberately, so it wins over the `[...path]` catch-all that
// otherwise hands unknown auth subpaths to the Neon Auth stock views — this pair
// is branded and enumeration-safe in our own words.

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const editionLabel = await getEditionLabel();

  return (
    <div className="flex min-h-svh flex-col">
      <QuiltBand />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-12">
        <NotConfiguredBanner />
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <ForgotPasswordForm />
          </CardContent>
        </Card>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {editionLabel}
        </p>
      </main>
    </div>
  );
}

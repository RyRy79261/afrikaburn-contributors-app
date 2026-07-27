import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { ResetPasswordForm } from "@/components/account/reset-password-form";
import { getEditionLabel } from "@/lib/edition";

// /auth/reset-password?token=… (canvas frames Gf1iJ + s2PAS, panel ②).
//
// The token arrives in the query string of the emailed link — Better Auth's
// `request-password-reset` appends it to whatever `redirectTo` we gave it, which
// `requestPasswordReset` sets to this route. `?error=` is also possible when the
// provider rejects the token before redirecting, so we treat a missing token and
// an error the same way: honest dead-end plus a way to request a fresh link.

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const editionLabel = await getEditionLabel();
  const usableToken = error ? null : token?.trim() || null;

  return (
    <div className="flex min-h-svh flex-col">
      <QuiltBand />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-12">
        <NotConfiguredBanner />
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <ResetPasswordForm token={usableToken} />
          </CardContent>
        </Card>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {editionLabel}
        </p>
      </main>
    </div>
  );
}

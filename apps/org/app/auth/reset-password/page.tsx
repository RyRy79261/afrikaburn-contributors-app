import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { ShieldCheck } from "lucide-react";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// /auth/reset-password?token=… — the token arrives in the emailed link's query
// string (Better Auth appends it to the redirectTo the action set). `?error=` is
// possible when the provider rejects the token before redirecting, so a missing
// token and an error are treated the same: an honest dead-end plus a way to
// request a fresh link. STATIC route, wins over the `[...path]` catch-all.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const usableToken = error ? null : (token?.trim() || null);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Organiser Console
        </p>
      </div>
      <NotConfiguredBanner />
      <QuiltBand opacity={0.55} className="rounded-full" />
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <ResetPasswordForm token={usableToken} />
        </CardContent>
      </Card>
    </main>
  );
}

import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { ShieldCheck } from "lucide-react";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

// /auth/forgot-password — a STATIC route that wins over the `[...path]`
// catch-all, so the console's recovery screen is branded and enumeration-safe in
// our own words rather than a stock provider view.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
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
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}

import { redirect } from "next/navigation";
import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { ShieldCheck } from "lucide-react";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AuthForm, type AuthMode } from "@/components/auth/auth-form";

// Branded organiser sign-in / sign-up, talking to our OWN self-hosted Better
// Auth at /api/auth/* (@quagga/auth). Forgot- and reset-password are their own
// STATIC routes that win over this catch-all; OAuth callbacks are handled by the
// route handler. Any other subpath redirects to sign-in rather than 404ing.
export const dynamic = "force-dynamic";

const BRANDED_VIEWS: Record<string, AuthMode> = {
  "sign-in": "sign-in",
  "sign-up": "sign-up",
};

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const view = path?.[0] ?? "sign-in";
  const mode = BRANDED_VIEWS[view];
  if (!mode) redirect("/auth/sign-in");

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
          <AuthForm mode={mode} />
        </CardContent>
      </Card>
    </main>
  );
}

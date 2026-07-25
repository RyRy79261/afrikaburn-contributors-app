import { AuthView } from "@neondatabase/auth/react/ui";
import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AuthForm, type AuthMode } from "@/components/auth/auth-form";
import { getEditionLabel } from "@/lib/edition";

// `dynamicParams` stays at the default (true) so any auth subpath Neon Auth
// redirects to (callback, reset, verify-email, …) renders via AuthView rather
// than 404ing. Sign-in and sign-up use the branded @quagga/ui form (design
// canvas frame u87N7); everything else falls back to the Neon Auth views.
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
  const editionLabel = await getEditionLabel();

  return (
    <div className="flex min-h-svh flex-col">
      {/* Full-width quilt edge (identity motif, edge-to-edge). */}
      <QuiltBand />

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-12">
        <NotConfiguredBanner />
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            {mode ? <AuthForm mode={mode} /> : <AuthView path={view} />}
          </CardContent>
        </Card>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {editionLabel}
        </p>
      </main>
    </div>
  );
}

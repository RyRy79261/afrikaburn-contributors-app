import { AuthView } from "@neondatabase/auth/react/ui";
import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";

// `dynamicParams` stays at the default (true) so any auth subpath Neon Auth
// redirects to (sign-in, sign-up, callback, reset, …) renders via AuthView
// rather than 404ing. Env-less, the views render but no session is established.
export const dynamic = "force-dynamic";

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const view = path?.[0] ?? "sign-in";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <NotConfiguredBanner />
      <QuiltBand opacity={0.55} className="rounded-full" />
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <AuthView path={view} />
        </CardContent>
      </Card>
    </main>
  );
}

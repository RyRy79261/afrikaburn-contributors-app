import { AuthView } from "@neondatabase/auth/react/ui";
import { Card, CardContent } from "@quagga/ui/components/card";
import { ShieldCheck } from "lucide-react";
import { NotConfiguredBanner } from "@/components/not-configured-banner";

// Neon Auth sign-in views for the console. `dynamicParams` stays default (true)
// so any auth subpath renders via AuthView rather than 404ing. Env-less, the
// views render but no session is established.
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
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Organiser Console
        </p>
      </div>
      <NotConfiguredBanner />
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <AuthView path={view} />
        </CardContent>
      </Card>
    </main>
  );
}

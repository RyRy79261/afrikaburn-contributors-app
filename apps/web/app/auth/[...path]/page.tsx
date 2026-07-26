import { redirect } from "next/navigation";
import {
  INVITE_AUTH_PARAM,
  INVITE_RESUME_PATH,
  wantsInviteResume,
} from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AuthForm, type AuthMode } from "@/components/auth/auth-form";
import { getEditionLabel } from "@/lib/edition";

// Branded sign-in / sign-up (design canvas frame u87N7), talking to our OWN
// self-hosted Better Auth at /api/auth/* (@quagga/auth). Forgot- and
// reset-password are their own STATIC routes (app/auth/forgot-password +
// reset-password) that win over this catch-all; verification and OAuth callbacks
// are handled by the route handler, not a page. Any other auth subpath has no
// branded view, so it redirects to sign-in rather than 404ing.
export const dynamic = "force-dynamic";

const BRANDED_VIEWS: Record<string, AuthMode> = {
  "sign-in": "sign-in",
  "sign-up": "sign-up",
};

export default async function AuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  const view = path?.[0] ?? "sign-in";
  const mode = BRANDED_VIEWS[view];
  if (!mode) redirect("/auth/sign-in");

  // `?next=invite` says "an invite is waiting on the far side of this". It is an
  // OPAQUE MARKER, never a caller-supplied url and never the invite token: the
  // token itself rides in an httpOnly cookie, so there is nothing here to leak
  // and nothing to abuse as an open redirect — the only value that resolves to
  // anything is the one fixed internal path below.
  const resumeInvite = wantsInviteResume((await searchParams)?.[INVITE_AUTH_PARAM]);
  const redirectTo = resumeInvite ? INVITE_RESUME_PATH : "/";

  const editionLabel = await getEditionLabel();

  return (
    <div className="flex min-h-svh flex-col">
      {/* Full-width quilt edge (identity motif, edge-to-edge). */}
      <QuiltBand />

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-12">
        <NotConfiguredBanner />
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <AuthForm mode={mode} redirectTo={redirectTo} />
          </CardContent>
        </Card>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {editionLabel}
        </p>
      </main>
    </div>
  );
}

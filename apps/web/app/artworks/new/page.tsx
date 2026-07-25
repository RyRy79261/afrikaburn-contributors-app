import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { ArtworkRegistrationForm } from "@/components/artworks/artwork-registration-form";
import { createArtworkRegistrationAction } from "./actions";

// /artworks/new — Art Project registration (canvas d3pOJI desktop, H2DP4
// mobile 360; docs/synthesis.md "art project registration draws on the
// participate/ARTeria/fire-safety pages"). One responsive route serves both.

export const dynamic = "force-dynamic";

export default async function NewArtworkPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Registering an art project" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  if (!user) {
    return (
      <AppShell>
        <PreviewNotice feature="Registering an art project" />
      </AppShell>
    );
  }
  // Onboarding (and any blocking questionnaire) gates everything else.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <Link
          href="/directory"
          className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to directory
        </Link>

        <header className="mb-6 flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Register an Art Project
          </h1>
          <p className="text-sm text-muted-foreground">
            Art lives on the Binnekring. Register your project so it can be
            placed, supported, and — if you like — considered for an art grant.
            To burn anything you build, you&rsquo;ll coordinate with the Art crew
            via the Arteria.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status="draft" />
            <span className="text-xs text-muted-foreground">
              Save a draft any time — your project exists the moment you save,
              and nothing goes to the Art crew until you submit.
            </span>
          </div>
        </header>

        <ArtworkRegistrationForm
          action={createArtworkRegistrationAction}
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
        />
      </div>
    </AppShell>
  );
}

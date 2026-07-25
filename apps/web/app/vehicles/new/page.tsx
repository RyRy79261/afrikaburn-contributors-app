import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { VehicleRegistrationForm } from "@/components/vehicles/vehicle-registration-form";
import { createVehicleRegistrationAction } from "./actions";

// /vehicles/new — Mutant Vehicle registration (canvas S8ZcWf desktop, Qq5u0
// mobile 360; docs/synthesis.md "MV registration mirrors the real DMV
// process"). One responsive route serves both frames.

export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Registering a mutant vehicle" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  if (!user) {
    return (
      <AppShell>
        <PreviewNotice feature="Registering a mutant vehicle" />
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
            Register a Mutant Vehicle
          </h1>
          <p className="text-sm text-muted-foreground">
            Pre-register with the DMV before you travel — unregistered mutants
            arriving on site are grounded. A DMV wrangler will email you after
            you submit.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status="draft" />
            <span className="text-xs text-muted-foreground">
              Save a draft any time — your mutant exists the moment you save,
              and nothing goes to the DMV until you submit.
            </span>
          </div>
        </header>

        <VehicleRegistrationForm
          action={createVehicleRegistrationAction}
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
        />
      </div>
    </AppShell>
  );
}

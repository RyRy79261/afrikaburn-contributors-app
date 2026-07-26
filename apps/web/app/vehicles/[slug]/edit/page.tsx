import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PROJECT_ADMIN_ROLES, type QuestionnaireResponses } from "@quagga/types";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getProjectRegistrationForEdit } from "@/lib/project-registration-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import {
  VehicleRegistrationForm,
  type VehicleFormInitialValues,
} from "@/components/vehicles/vehicle-registration-form";
import { VEHICLE_ACK_KEYS, type VehicleAckKey } from "@/app/vehicles/new/copy";
import { updateVehicleRegistrationAction } from "./actions";

// /vehicles/[slug]/edit — re-open a Mutant Vehicle registration to edit and
// resubmit (roadmap M4-10). Editable only while draft / changes_requested; once
// approved it locks. Prefill comes from the self-describing answer payload the
// create/update flow persists.

export const dynamic = "force-dynamic";

function asString(v: QuestionnaireResponses[string] | undefined): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: QuestionnaireResponses[string] | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asBoolOrNull(
  v: QuestionnaireResponses[string] | undefined,
): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Map the stored answer payload back to the form's prefill shape. */
function toInitialValues(
  name: string,
  answers: QuestionnaireResponses | null,
): VehicleFormInitialValues {
  const a = answers ?? {};
  const sound = asString(a.soop_level);
  const acks = asStringArray(a.acknowledgements).filter(
    (k): k is VehicleAckKey => (VEHICLE_ACK_KEYS as readonly string[]).includes(k),
  );
  return {
    name,
    baseVehicle: asString(a.base_vehicle),
    mutation: asString(a.mutation_description),
    photoUrls: asStringArray(a.photos),
    soundLevel: sound.length > 0 ? sound : null,
    flameEffects: asBoolOrNull(a.flame_effects),
    nightDriving: asBoolOrNull(a.night_driving),
    acks,
  };
}

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Editing a mutant vehicle registration" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  if (!user) {
    return (
      <AppShell>
        <PreviewNotice feature="Editing a mutant vehicle registration" />
      </AppShell>
    );
  }
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Editing a mutant vehicle registration" />
      </AppShell>
    );
  }

  const ctx = await getProjectRegistrationForEdit(
    slug,
    "mutant_vehicle",
    user.id,
    edition.id,
  );
  if (!ctx) notFound();

  // Only a lead/admin may edit; others go back to the project dashboard.
  if (!ctx.role || !PROJECT_ADMIN_ROLES.includes(ctx.role)) {
    redirect(`/camps/${slug}`);
  }

  const header = (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/camps/${slug}`}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to {ctx.group.name}
      </Link>
    </div>
  );

  // Locked (approved / rejected / withdrawn / already submitted): read-only note.
  if (!ctx.editable) {
    return (
      <AppShell>
        {header}
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {ctx.group.name}
              </h1>
              <StatusBadge status={ctx.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              This registration is locked in its current state and can&apos;t be
              edited. If something needs to change, contact the DMV wrangler
              handling your mutant.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {header}
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit {ctx.group.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Update your mutant&apos;s registration and resubmit it to the DMV.
            Save a draft any time — nothing goes back to the DMV until you
            resubmit.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={ctx.status} />
          </div>
        </header>

        <VehicleRegistrationForm
          action={updateVehicleRegistrationAction.bind(null, slug)}
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          initialValues={toInitialValues(ctx.group.name, ctx.answers)}
          nameLocked
          submitLabel={
            ctx.status === "changes_requested"
              ? "Resubmit to DMV"
              : "Submit to DMV"
          }
        />
      </div>
    </AppShell>
  );
}

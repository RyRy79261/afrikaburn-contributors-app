import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { RegistrationSummary } from "@/components/registration/registration-summary";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  getDeclaredSupplierIds,
  getRegistration,
  getRegistrationCampContext,
  getSectionReviews,
  isEditableStatus,
  listSuppliersForPicker,
  type RegistrationValues,
} from "@/lib/registration-store";
import {
  saveRegistrationDraftAction,
  submitRegistrationAction,
  withdrawRegistrationAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Blank draft values for a registration that hasn't been started. */
function emptyValues(description: string | null): RegistrationValues {
  return {
    campDescription: description,
    s1ContactEmail: null,
    s1AltContactName: null,
    s1AltContactPhone: null,
    s1AltContactEmail: null,
    s2LntPlan: null,
    s2LntLeadName: null,
    s2LntLeadPhone: null,
    s2LntLeadEmail: null,
    s3ParticipationPlan: null,
    s3OperatingHours: [],
    s3ScheduleDetail: null,
    s3GiftingFood: null,
    s4ExpectedPopulation: null,
    s4FirstArrivalDate: null,
    s4WorkAccessPasses: null,
    s4AreaDimensions: null,
    s4LayoutUploadUrls: [],
    s5AmplifiedMusic: null,
    s5SoundPlan: null,
    s5PlacementFirstChoice: null,
    s5PlacementSecondChoice: null,
    s5NeighbourRequest: null,
    s5FamilyFriendly: null,
    s6SuppliersNote: null,
    s6PaidPerformers: null,
    s6FeeStructure: null,
    s6ExpectedBudgetZar: null,
    s6PlugAndPlayAck: null,
    supplierIds: [],
  };
}

export default async function RegistrationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp registration" />
      </AppShell>
    );
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await getCurrentCampUser();
  if (!campUser) redirect("/auth/sign-in");
  // Hard gate: a pending blocking action must be cleared before the workspace.
  await enforceGate(campUser.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp registration" />
      </AppShell>
    );
  }

  const context = await getRegistrationCampContext(slug, campUser.id, edition);
  if (!context) notFound();

  // Only a lead/admin may edit or view the registration workspace.
  if (!context.role || !PROJECT_ADMIN_ROLES.includes(context.role)) {
    redirect(`/camps/${slug}`);
  }

  const registration = await getRegistration(context.group.id, context.editionId);
  const status = registration?.status ?? "draft";
  const suppliers = await listSuppliersForPicker(context.editionId);

  const header = (
    <header className="mb-6 flex flex-col gap-2">
      <Link
        href={`/camps/${slug}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to {context.group.name}
      </Link>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {context.editionName} · Theme camp registration
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {context.group.name}
        </h1>
      </div>
    </header>
  );

  // Editable path: draft or changes_requested (the resubmit loop).
  if (isEditableStatus(status)) {
    const declaredIds = registration
      ? await getDeclaredSupplierIds(registration.id)
      : [];
    const reviews = registration
      ? await getSectionReviews(registration.id, context.editionId)
      : [];

    const initialValues: RegistrationValues = registration
      ? {
          campDescription: context.group.description,
          s1ContactEmail: registration.s1ContactEmail,
          s1AltContactName: registration.s1AltContactName,
          s1AltContactPhone: registration.s1AltContactPhone,
          s1AltContactEmail: registration.s1AltContactEmail,
          s2LntPlan: registration.s2LntPlan,
          s2LntLeadName: registration.s2LntLeadName,
          s2LntLeadPhone: registration.s2LntLeadPhone,
          s2LntLeadEmail: registration.s2LntLeadEmail,
          s3ParticipationPlan: registration.s3ParticipationPlan,
          s3OperatingHours: registration.s3OperatingHours,
          s3ScheduleDetail: registration.s3ScheduleDetail,
          s3GiftingFood: registration.s3GiftingFood,
          s4ExpectedPopulation: registration.s4ExpectedPopulation,
          s4FirstArrivalDate: registration.s4FirstArrivalDate,
          s4WorkAccessPasses: registration.s4WorkAccessPasses,
          s4AreaDimensions: registration.s4AreaDimensions,
          s4LayoutUploadUrls: registration.s4LayoutUploadUrls,
          s5AmplifiedMusic: registration.s5AmplifiedMusic,
          s5SoundPlan: registration.s5SoundPlan,
          s5PlacementFirstChoice: registration.s5PlacementFirstChoice,
          s5PlacementSecondChoice: registration.s5PlacementSecondChoice,
          s5NeighbourRequest: registration.s5NeighbourRequest,
          s5FamilyFriendly: registration.s5FamilyFriendly,
          s6SuppliersNote: registration.s6SuppliersNote,
          s6PaidPerformers: registration.s6PaidPerformers,
          s6FeeStructure: registration.s6FeeStructure,
          s6ExpectedBudgetZar: registration.s6ExpectedBudgetZar,
          s6PlugAndPlayAck: registration.s6PlugAndPlayAck,
          supplierIds: declaredIds,
        }
      : emptyValues(context.group.description);

    return (
      <AppShell>
        {header}
        <RegistrationWizard
          slug={slug}
          campName={context.group.name}
          status={status as "draft" | "changes_requested"}
          editionYear={context.editionYear}
          initialValues={initialValues}
          suppliers={suppliers}
          reviews={reviews}
          viewerUserId={campUser.id}
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          saveAction={saveRegistrationDraftAction}
          submitAction={submitRegistrationAction}
          withdrawAction={withdrawRegistrationAction}
        />
      </AppShell>
    );
  }

  // Locked path: submitted / under_review / approved / rejected / withdrawn.
  const reviews = registration
    ? await getSectionReviews(registration.id, context.editionId)
    : [];
  const declaredIds = registration
    ? await getDeclaredSupplierIds(registration.id)
    : [];
  const supplierNames = suppliers
    .filter((s) => declaredIds.includes(s.id))
    .map((s) => s.name);

  return (
    <AppShell>
      {header}
      {registration ? (
        <RegistrationSummary
          registration={registration}
          campName={context.group.name}
          description={context.group.description}
          supplierNames={supplierNames}
          reviews={reviews}
          slug={slug}
          viewerUserId={campUser.id}
        />
      ) : (
        <PreviewNotice feature="Camp registration" />
      )}
    </AppShell>
  );
}

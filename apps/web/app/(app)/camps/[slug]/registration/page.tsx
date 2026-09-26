import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, GitCompare, History } from "lucide-react";
import {
  canViewCampRegistration,
  pastSubmittedRegistrations,
  selectComparisonPrior,
} from "@quagga/core";
import { PreviewNotice } from "@/components/preview-notice";
import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { RegistrationSummary } from "@/components/registration/registration-summary";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  getDeclaredSupplierIds,
  getDeclaredSuppliers,
  getRegistration,
  getRegistrationCampContext,
  getSectionReviews,
  isEditableStatus,
  listPriorRegistrations,
  listSuppliersForPicker,
  toCarryForwardSource,
  type RegistrationValues,
} from "@/lib/registration-store";
import { CarryForwardBanner } from "@/components/registration/carry-forward-banner";
import {
  saveRegistrationDraftAction,
  submitRegistrationAction,
  reopenRegistrationAction,
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
    return <PreviewNotice feature="Camp registration" />;
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await getCurrentCampUser();
  if (!campUser) redirect("/auth/sign-in");
  // Hard gate: a pending blocking action must be cleared before the workspace.
  await enforceGate(campUser.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return <PreviewNotice feature="Camp registration" />;
  }

  const context = await getRegistrationCampContext(slug, campUser.id, edition);
  if (!context) notFound();

  // Only a lead/admin may edit or view the registration workspace — the same
  // @quagga/core predicate that guards its read-only companions (history,
  // changes), so the workspace and its history can never disagree on who.
  if (!canViewCampRegistration(context.role)) {
    redirect(`/camps/${slug}`);
  }

  const [registration, priors] = await Promise.all([
    getRegistration(context.group.id, context.editionId),
    // Every earlier registration of this camp (a handful of rows): the
    // carry-forward choices, the "Past registrations" link and the "what
    // changed" link all read this one list.
    listPriorRegistrations(context.group.id, context.editionYear),
  ]);
  const status = registration?.status ?? "draft";
  const target = {
    groupId: context.group.id,
    editionYear: context.editionYear,
  };
  const hasPast = pastSubmittedRegistrations(priors, target).length > 0;
  const comparisonPrior = selectComparisonPrior({
    current: {
      ...target,
      carriedForwardFromId: registration?.carriedForwardFromId ?? null,
    },
    candidates: priors,
  });

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
      {hasPast || comparisonPrior ? (
        <nav
          aria-label="Earlier registrations"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
        >
          {comparisonPrior && isEditableStatus(status) ? (
            <Link
              href={`/camps/${slug}/registration/changes`}
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              <GitCompare className="h-4 w-4" aria-hidden />
              What changed since {comparisonPrior.prior.editionYear}
            </Link>
          ) : null}
          {hasPast ? (
            <Link
              href={`/camps/${slug}/registration/history`}
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              <History className="h-4 w-4" aria-hidden />
              Past registrations
            </Link>
          ) : null}
        </nav>
      ) : null}
    </header>
  );

  // Editable path: draft or changes_requested (the resubmit loop).
  if (isEditableStatus(status)) {
    // The picker repository — editable path only; the locked summary reads the
    // declarations themselves so a suspended supplier isn't dropped from them.
    const suppliers = await listSuppliersForPicker(context.editionId);
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

    // The carry-forward offer, only while it is still an offer: once this
    // year's draft has been seeded there is nothing to bring across, and a
    // banner that stays put after you have pressed it reads as a failure.
    //
    // Every earlier edition is offered, newest first (PREVYR-014); the server
    // re-validates whichever one comes back.
    const carryForwardSources = registration?.carriedForwardAt
      ? []
      : priors.map(toCarryForwardSource);

    return (
      <>
        {header}
        {carryForwardSources.length > 0 ? (
          <CarryForwardBanner
            slug={slug}
            sources={carryForwardSources}
            editionYear={context.editionYear}
          />
        ) : null}
        <RegistrationWizard
          slug={slug}
          campName={context.group.name}
          status={status as "draft" | "changes_requested"}
          editionYear={context.editionYear}
          initialValues={initialValues}
          suppliers={suppliers}
          reviews={reviews}
          decisionReason={registration?.decisionReason ?? null}
          viewerUserId={campUser.id}
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          saveAction={saveRegistrationDraftAction}
          submitAction={submitRegistrationAction}
          withdrawAction={withdrawRegistrationAction}
        />
      </>
    );
  }

  // Locked path: submitted / under_review / approved / rejected / withdrawn.
  const reviews = registration
    ? await getSectionReviews(registration.id, context.editionId)
    : [];
  // Read the declarations directly. This used to intersect the declared ids with
  // `suppliers` — the PICKER list — which excludes suspended suppliers by
  // design, so suspending a supplier silently erased it from every camp's
  // submitted answers. The summary now shows what was declared and marks the
  // suspension instead.
  const declaredSuppliers = registration
    ? await getDeclaredSuppliers(registration.id)
    : [];

  return (
    <>
      {header}
      {registration ? (
        <RegistrationSummary
          registration={registration}
          campName={context.group.name}
          description={context.group.description}
          declaredSuppliers={declaredSuppliers}
          reviews={reviews}
          slug={slug}
          editionYear={context.editionYear}
          viewerUserId={campUser.id}
          reopenAction={reopenRegistrationAction}
          withdrawAction={withdrawRegistrationAction}
        />
      ) : (
        <PreviewNotice feature="Camp registration" />
      )}
    </>
  );
}

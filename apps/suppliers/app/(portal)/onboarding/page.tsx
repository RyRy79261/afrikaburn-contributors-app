import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  OnboardingChecklist,
  type StepData,
} from "@/components/onboarding-checklist";
import { buildStepCardModel, stepEyebrow } from "@/lib/onboarding-view";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const { progress, supplier, edition } = session;

  const steps: StepData[] = progress.steps.map((view) => ({
    key: view.step.key,
    order: view.step.order,
    title: view.step.title,
    eyebrow: stepEyebrow(view.step),
    description: view.step.description,
    model: buildStepCardModel(view),
  }));

  const pct = Math.round((progress.completed / progress.total) * 100);

  return (
    <div>
      <PageHeading
        eyebrow={`Supplier Depot onboarding · ${edition.name}`}
        title="Your onboarding checklist"
        description="Seven steps from the real Supplier Depot process. You complete some yourself; AfrikaBurn confirms the deposit, briefing, and fee. Read each rule right where you act on it."
        actions={
          <Badge variant={progress.isOnboarded ? "success" : "secondary"}>
            {progress.completed}/{progress.total} done
          </Badge>
        }
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {progress.isOnboarded
                  ? "Onboarding complete"
                  : "Onboarding progress"}
              </CardTitle>
              <CardDescription>
                {progress.isOnboarded
                  ? "Every step is confirmed — you're fully onboarded for this edition."
                  : progress.awaiting > 0
                    ? `${progress.awaiting} step${progress.awaiting === 1 ? "" : "s"} awaiting AfrikaBurn confirmation.`
                    : "Work through each step below. Progress saves as you go."}
              </CardDescription>
            </div>
            {progress.isOnboarded && (
              <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress.completed}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Onboarding steps completed"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/*
        Documents & links panel seam — canvas Q4fye "Documents Panel".
        BLOCKED on #8 (supplier_documents schema): there is no table yet to hold
        the required/optional documents, acknowledgements, or download links, so
        the panel is not rendered to suppliers. This is a flagged, hidden slot
        (same pattern as the wave-1 pinned-banner seam): once #8 lands, replace
        this stub with the real <DocumentsPanel documents={...} /> in-place. No
        supplier-facing UI ships from this seam.
      */}
      <div hidden aria-hidden data-seam="supplier-documents-panel" />

      <OnboardingChecklist
        steps={steps}
        profile={{
          name: supplier.name,
          services: supplier.services ?? "",
          contact: supplier.contact ?? "",
          website: supplier.website ?? "",
        }}
      />
    </div>
  );
}

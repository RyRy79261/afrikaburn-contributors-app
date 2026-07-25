import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { supplierOnboardingStep } from "@quagga/core";
import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  OnboardingChecklist,
  type StepData,
} from "@/components/onboarding-checklist";
import {
  DocumentsPanel,
  type DocumentRow,
} from "@/components/documents-panel";
import { buildStepCardModel, stepEyebrow } from "@/lib/onboarding-view";
import { loadSupplierDocumentsPanel } from "@/lib/documents";

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

  // Documents & links for this edition, joined to this supplier's acks. The step
  // TITLE is resolved here (server side) from the core catalog so the client
  // panel never has to carry it.
  const documents = await loadSupplierDocumentsPanel(supplier.id, edition.id);
  const documentRows: DocumentRow[] = documents.views.map((view) => ({
    id: view.document.id,
    title: view.document.title,
    sourceType: view.document.sourceType,
    url: view.document.url,
    requiredAck: view.document.requiredAck,
    acked: view.acked,
    outstanding: view.outstanding,
    stepTitle: view.document.stepKey
      ? (supplierOnboardingStep(view.document.stepKey)?.title ?? null)
      : null,
  }));

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
        Documents & links panel — canvas Q4fye "Documents Panel". Unblocked by
        migration 0011 (`supplier_documents` + `supplier_document_acks`). The
        panel renders ONLY when the org has published documents for this edition:
        an empty catalog shows nothing at all rather than an empty card.
      */}
      {documentRows.length > 0 && (
        <DocumentsPanel
          documents={documentRows}
          acked={documents.progress.acked}
          required={documents.progress.required}
        />
      )}

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

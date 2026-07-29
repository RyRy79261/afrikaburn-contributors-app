import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { supplierOnboardingStep } from "@quagga/core";
import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  OnboardingChecklist,
  type StepData,
  type StepDocument,
} from "@/components/onboarding-checklist";
import { DocumentsPanel, type DocumentRow } from "@/components/documents-panel";
import {
  buildStepCardModel,
  stepEyebrow,
  supplierCodeChipValue,
} from "@/lib/onboarding-view";
import { loadSupplierDocumentsPanel } from "@/lib/documents";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const { progress, supplier, edition } = session;

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

  // The same documents, indexed by the step they are bound to, so a step card can
  // LINK to the thing it asks the supplier to attest they have read instead of
  // naming it and showing nothing. Only `requiredAck` documents count: those are
  // what completion is reconciled against (`applyDocumentAcksToSteps`), and a
  // document with no checkbox can never complete anything.
  const boundDocuments = new Map<string, StepDocument[]>();
  for (const view of documents.views) {
    const key = view.document.stepKey;
    if (!key || !view.document.requiredAck) continue;
    const list = boundDocuments.get(key) ?? [];
    list.push({
      id: view.document.id,
      title: view.document.title,
      sourceType: view.document.sourceType,
      url: view.document.url,
    });
    boundDocuments.set(key, list);
  }

  const steps: StepData[] = progress.steps.map((view) => ({
    key: view.step.key,
    order: view.step.order,
    title: view.step.title,
    eyebrow: stepEyebrow(view.step),
    description: view.step.description,
    model: buildStepCardModel(view),
    documents: boundDocuments.get(view.step.key) ?? [],
  }));

  const pct = Math.round((progress.completed / progress.total) * 100);

  // The SUPPLIER CODE chip (canvas `D6Xsb` desktop / `FqxsW` mobile). Null for
  // an imported row that has not been backfilled yet — the chip then renders
  // nothing at all, never a placeholder that reads like a real code.
  const supplierCode = supplierCodeChipValue(supplier.code);

  return (
    <div>
      <PageHeading
        eyebrow={`Supplier Depot onboarding · ${edition.name}`}
        title="Your onboarding checklist"
        description="Seven steps from the real Supplier Depot process. You complete some yourself; AfrikaBurn confirms the deposit, briefing, and fee. Read each rule right where you act on it."
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          {/*
            Frame `Q4fye` node `rRVfg` (desktop) / `lm3jO` node `M1YX5` (mobile):
            one row on desktop — count + sub-copy left, the SUPPLIER CODE chip
            right-aligned; stacked on mobile with the chip left-aligned beneath.
          */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {/* Canvas `xHZmz`: the count IS the headline, not a bare label. */}
                <span>
                  {progress.completed} of {progress.total} steps complete
                </span>
                {progress.isOnboarded && (
                  <CheckCircle2
                    className="h-5 w-5 shrink-0 text-success"
                    aria-hidden
                  />
                )}
              </CardTitle>
              <CardDescription>
                {progress.isOnboarded
                  ? "Every step is confirmed — you're fully onboarded for this edition."
                  : progress.awaiting > 0
                    ? `${progress.awaiting} step${progress.awaiting === 1 ? "" : "s"} awaiting AfrikaBurn confirmation.`
                    : "Work through each step below. Progress saves as you go."}
              </CardDescription>
            </div>
            {supplierCode && (
              <dl className="flex shrink-0 flex-col gap-0.5 sm:items-end">
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Supplier code
                </dt>
                <dd className="select-all font-mono text-[15px] font-bold leading-none text-primary">
                  {supplierCode}
                </dd>
              </dl>
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

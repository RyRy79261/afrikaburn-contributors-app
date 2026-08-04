"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleDashed,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import type { SupplierOnboardingStepKey } from "@quagga/types";
import { setOnboardingStep } from "@/lib/actions/onboarding";
import { setDocumentAcknowledgement } from "@/lib/actions/documents";
import { updateSupplierProfile } from "@/lib/actions/register";
import type { StepCardModel, StepStatusTone } from "@/lib/onboarding-view";

/**
 * A required document the org has bound to this step. When a step carries any of
 * these, acknowledging them is the ONLY thing that completes it — the server
 * refuses a direct step write for exactly that reason — so the card's control
 * writes acknowledgements, and the card can link to what it asks about.
 */
export interface StepDocument {
  id: string;
  title: string;
  sourceType: "file" | "link";
  url: string;
}

export interface StepData {
  key: SupplierOnboardingStepKey;
  order: number;
  title: string;
  /** "Step N · Org confirms" — the who-completes/who-confirms eyebrow. */
  eyebrow: string;
  description: string;
  model: StepCardModel;
  /** Required documents bound to this step, in catalog order. Often empty. */
  documents: StepDocument[];
}

export interface SupplierProfile {
  name: string;
  services: string;
  contact: string;
  website: string;
}

const TONE_STYLES: Record<
  StepStatusTone,
  { badge: string; ring: string; icon: React.ReactNode }
> = {
  done: {
    badge: "bg-success/20 text-success",
    ring: "border-success/40",
    icon: <Check className="h-3.5 w-3.5" aria-hidden />,
  },
  awaiting: {
    badge: "bg-warning/20 text-warning",
    ring: "border-warning/40",
    icon: <Clock className="h-3.5 w-3.5" aria-hidden />,
  },
  pending: {
    badge: "bg-muted text-muted-foreground",
    ring: "border-border",
    icon: <CircleDashed className="h-3.5 w-3.5" aria-hidden />,
  },
};

function StatusPill({ model }: { model: StepCardModel }) {
  const t = TONE_STYLES[model.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide",
        t.badge,
      )}
    >
      {t.icon}
      {model.statusLabel}
    </span>
  );
}

export function OnboardingChecklist({
  steps,
  profile,
}: {
  steps: StepData[];
  profile: SupplierProfile;
}) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step) => (
        <li key={step.key}>
          <StepCard step={step} profile={profile} />
        </li>
      ))}
    </ol>
  );
}

function StepCard({
  step,
  profile,
}: {
  step: StepData;
  profile: SupplierProfile;
}) {
  const t = TONE_STYLES[step.model.tone];
  return (
    <Card className={cn("border", t.ring)}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                t.badge,
              )}
              aria-hidden
            >
              {t.icon}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                {step.eyebrow}
              </span>
              <CardTitle className="text-base">{step.title}</CardTitle>
            </div>
          </div>
          <StatusPill model={step.model} />
        </div>
        <CardDescription className="leading-relaxed">
          {step.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StepAction step={step} profile={profile} />
      </CardContent>
    </Card>
  );
}

function StepAction({
  step,
  profile,
}: {
  step: StepData;
  profile: SupplierProfile;
}) {
  const { flow } = step.model;

  if (flow === "org_confirmed") {
    // Payment steps (deposit / fee) may only ever use receipt-confirmation
    // wording — the platform never holds or processes funds, so no copy may
    // imply anything is paid *through* the portal. The briefing step is an
    // attendance confirmation, not a payment.
    const isPaymentStep =
      step.key === "deposit_paid" || step.key === "registration_fee_paid";
    const pending = isPaymentStep
      ? "Awaiting AfrikaBurn. AfrikaBurn confirms receipt here — nothing is ever paid through this portal."
      : "Awaiting AfrikaBurn — the Supplier Team confirms this here once it's done.";
    return (
      <p className="text-sm text-muted-foreground">
        {step.model.tone === "done"
          ? "AfrikaBurn has confirmed this step."
          : pending}
      </p>
    );
  }

  if (step.key === "registration_form") {
    return <RegistrationStepForm profile={profile} />;
  }
  if (step.key === "agreement_signed") {
    return <AgreementStep step={step} />;
  }
  // org_reviewed — inventory / crew
  if (step.key === "inventory_submitted") {
    return <InventoryStep step={step} />;
  }
  if (step.key === "crew_details_submitted") {
    return <CrewStep step={step} />;
  }
  return <SimpleStepActions step={step} />;
}

/** Shared transition + toast wrapper for a step status change. */
function useStepTransition() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(
    stepKey: SupplierOnboardingStepKey,
    to: Parameters<typeof setOnboardingStep>[0]["to"],
    successMsg: string,
  ) {
    startTransition(async () => {
      const result = await setOnboardingStep({ stepKey, to });
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error("Couldn't update that step", {
          description: result.error,
        });
      }
    });
  }

  return { pending, run };
}

/**
 * Acknowledge (or withdraw) every required document bound to a step, as one user
 * action. This is the ONLY writer of a document-bound step — `setOnboardingStep`
 * refuses those outright — so the checklist button and the Documents panel
 * checkbox now drive the same acknowledgement rather than two different things
 * that disagreed with each other.
 *
 * Sequential, and it stops on the first refusal: a partial acknowledgement is a
 * real state (the step simply stays incomplete until the rest are ticked), so
 * there is nothing to unwind — but continuing past an error would bury it.
 */
function useDocumentAcks() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setAcks(
    documents: StepDocument[],
    acknowledged: boolean,
    successMsg: string,
  ) {
    startTransition(async () => {
      for (const doc of documents) {
        const result = await setDocumentAcknowledgement({
          documentId: doc.id,
          acknowledged,
        });
        if (!result.ok) {
          toast.error("Couldn't update that step", {
            description: result.error,
          });
          router.refresh();
          return;
        }
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  return { pending, setAcks };
}

/**
 * Links to the documents a step is bound to.
 *
 * THE DEFECT THIS CLOSES: the agreement card asked suppliers to tick "I have read
 * and agree to the AfrikaBurn Supplier Agreement" while showing them no agreement
 * at all. When the org had published one it sat in the Documents panel further up
 * the page with nothing connecting the two; when it hadn't, the attestation was
 * about a document that did not exist anywhere in the portal. Every link here is
 * rendered FROM a bound document, so this can never name one that isn't there.
 */
function BoundDocumentLinks({ documents }: { documents: StepDocument[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {documents.map((doc) => (
        <li key={doc.id}>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {doc.sourceType === "file" ? (
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            Read {doc.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function SimpleStepActions({ step }: { step: StepData }) {
  const { pending, run } = useStepTransition();
  const { primaryAction, secondaryAction } = step.model;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primaryAction && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(step.key, primaryAction.to, "Step updated.")}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {primaryAction.label}
        </Button>
      )}
      {secondaryAction && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(step.key, secondaryAction.to, "Step updated.")}
        >
          {secondaryAction.label}
        </Button>
      )}
    </div>
  );
}

function RegistrationStepForm({ profile }: { profile: SupplierProfile }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(profile);
  const [open, setOpen] = useState(false);

  function set(key: keyof SupplierProfile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await updateSupplierProfile({
        name: form.name,
        services: form.services || undefined,
        contact: form.contact || undefined,
        website: form.website || undefined,
      });
      if (result.ok) {
        toast.success("Registration details saved.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Couldn't save", { description: result.error });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <Detail label="Business" value={form.name} />
          <Detail label="Services" value={form.services} />
          <Detail label="Contact" value={form.contact} />
          <Detail label="Website" value={form.website} />
        </dl>
        <div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Edit registration details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormField label="Business name" required>
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </FormField>
      <FormField label="Services">
        <Textarea
          rows={2}
          value={form.services}
          onChange={(e) => set("services", e.target.value)}
        />
      </FormField>
      <FormField label="Contact">
        <Input
          value={form.contact}
          onChange={(e) => set("contact", e.target.value)}
        />
      </FormField>
      <FormField label="Website">
        <Input
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || form.name.trim().length === 0}
          onClick={save}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save details
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Step 2 — signing the Supplier Agreement.
 *
 * Which control this renders depends on whether the org has bound a required
 * document to the step, because that decides who may complete it:
 *
 *  - BOUND — the acknowledgement completes the step, and it is the only thing
 *    that may (`setOnboardingStep` refuses a bound step server-side). The card
 *    links to the agreement and its button writes the acknowledgement, so the
 *    supplier can read the document they are attesting to, and so ticking some
 *    other document later can no longer silently un-sign this one.
 *  - UNBOUND — there is no agreement in the portal to have read, so the wording
 *    does not pretend otherwise: it attests to the agreement AfrikaBurn supplied
 *    off-platform, and says plainly that the portal has no copy.
 */
function AgreementStep({ step }: { step: StepData }) {
  const { pending: stepPending, run } = useStepTransition();
  const { pending: ackPending, setAcks } = useDocumentAcks();
  const [ack, setAck] = useState(step.model.status === "completed");

  const bound = step.documents;
  const busy = stepPending || ackPending;

  if (step.model.status === "completed") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-success">
            You&apos;ve acknowledged the Supplier Agreement.
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              bound.length > 0
                ? setAcks(bound, false, "Acknowledgement withdrawn.")
                : run(step.key, "pending", "Acknowledgement withdrawn.")
            }
          >
            Undo
          </Button>
        </div>
        {bound.length > 0 && <BoundDocumentLinks documents={bound} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {bound.length > 0 && <BoundDocumentLinks documents={bound} />}
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-[var(--color-primary)]"
        />
        <span className="text-muted-foreground">
          {bound.length > 0 ? (
            <>
              I have read the Supplier Agreement linked above and agree to it,
              and I understand my deposit is refunded only on full compliance
              with it.
            </>
          ) : (
            <>
              I agree to the AfrikaBurn Supplier Agreement as the Supplier Team
              has provided it to me, and I understand my deposit is refunded
              only on full compliance with it.
            </>
          )}
        </span>
      </label>
      {bound.length === 0 && (
        <p className="text-xs text-muted-foreground">
          AfrikaBurn hasn&apos;t published the agreement in this portal for this
          edition. Ask the Supplier Team for a copy at suppliers@afrikaburn.com
          before you sign.
        </p>
      )}
      <div>
        <Button
          size="sm"
          disabled={!ack || busy}
          onClick={() =>
            bound.length > 0
              ? setAcks(bound, true, "Agreement acknowledged.")
              : run(step.key, "completed", "Agreement acknowledged.")
          }
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Sign the agreement
        </Button>
      </div>
    </div>
  );
}

function InventoryStep({ step }: { step: StepData }) {
  const { pending, run } = useStepTransition();
  const [draft, setDraft] = useState("");

  if (step.model.status === "awaiting_confirmation") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-warning">
          Submitted — awaiting AfrikaBurn review of your inventory.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(step.key, "pending", "Submission withdrawn.")}
        >
          Withdraw submission
        </Button>
      </div>
    );
  }
  if (step.model.status === "completed") {
    return (
      <p className="text-sm text-success">
        AfrikaBurn has reviewed and accepted your delivery inventory.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormField label="Delivery summary (optional draft)">
        <Textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 4× stretch tents, rigging kit, generator — delivered Thu before gate"
        />
      </FormField>
      <p className="text-xs text-muted-foreground">
        The official inventory is submitted on the Google Sheet provided by the
        Supplier Team, who validate project codes. This box is a working draft
        (file uploads land in a later release). Submitting flags the step for
        AfrikaBurn to review.
      </p>
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              step.key,
              "awaiting_confirmation",
              "Inventory submitted for review.",
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Submit inventory for review
        </Button>
      </div>
    </div>
  );
}

interface CrewRow {
  id: number;
  name: string;
  idNumber: string;
}

function CrewStep({ step }: { step: StepData }) {
  const { pending, run } = useStepTransition();
  const [rows, setRows] = useState<CrewRow[]>([
    { id: 1, name: "", idNumber: "" },
  ]);

  if (step.model.status === "awaiting_confirmation") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-warning">
          Submitted — awaiting AfrikaBurn review of your crew list.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(step.key, "pending", "Submission withdrawn.")}
        >
          Withdraw submission
        </Button>
      </div>
    );
  }
  if (step.model.status === "completed") {
    return (
      <p className="text-sm text-success">
        AfrikaBurn has reviewed and accepted your crew details.
      </p>
    );
  }

  function setRow(id: number, key: "name" | "idNumber", value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: (rs.at(-1)?.id ?? 0) + 1, name: "", idNumber: "" },
    ]);
  }
  function removeRow(id: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              value={r.name}
              onChange={(e) => setRow(r.id, "name", e.target.value)}
              placeholder="Crew name"
              className="flex-1"
            />
            <Input
              value={r.idNumber}
              onChange={(e) => setRow(r.id, "idNumber", e.target.value)}
              placeholder="ID number"
              className="w-40"
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove crew member"
              onClick={() => removeRow(r.id)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus aria-hidden />
          Add crew member
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Everyone needing site access must be listed with a valid ticket, and a
        participant must accompany you during setup or drop-off. This is a
        working draft (secure crew uploads land in a later release). Submitting
        flags the step for AfrikaBurn to review.
      </p>
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              step.key,
              "awaiting_confirmation",
              "Crew details submitted for review.",
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Submit crew details for review
        </Button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-foreground">{value || "—"}</dd>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleDashed,
  Clock,
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
import { updateSupplierProfile } from "@/lib/actions/register";
import type { StepCardModel, StepStatusTone } from "@/lib/onboarding-view";

export interface StepData {
  key: SupplierOnboardingStepKey;
  order: number;
  title: string;
  description: string;
  model: StepCardModel;
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
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
              {step.order}
            </span>
            <CardTitle className="text-base">{step.title}</CardTitle>
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
    return (
      <p className="text-sm text-muted-foreground">
        {step.model.tone === "done"
          ? "AfrikaBurn has confirmed this step."
          : "Awaiting AfrikaBurn confirmation — the Supplier Team records this once it's done. Tracked here only; the platform never processes payments."}
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
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
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

function AgreementStep({ step }: { step: StepData }) {
  const { pending, run } = useStepTransition();
  const [ack, setAck] = useState(step.model.status === "completed");

  if (step.model.status === "completed") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-success">
          You&apos;ve acknowledged the Supplier Agreement.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(step.key, "pending", "Acknowledgement withdrawn.")}
        >
          Undo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-[var(--color-primary)]"
        />
        <span className="text-muted-foreground">
          I have read and agree to the AfrikaBurn Supplier Agreement, and I
          understand my deposit is refunded only on full compliance with it.
        </span>
      </label>
      <div>
        <Button
          size="sm"
          disabled={!ack || pending}
          onClick={() => run(step.key, "completed", "Agreement acknowledged.")}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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
            run(step.key, "awaiting_confirmation", "Inventory submitted for review.")
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
  const [rows, setRows] = useState<CrewRow[]>([{ id: 1, name: "", idNumber: "" }]);

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
    setRows((rs) => [...rs, { id: (rs.at(-1)?.id ?? 0) + 1, name: "", idNumber: "" }]);
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
            run(step.key, "awaiting_confirmation", "Crew details submitted for review.")
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

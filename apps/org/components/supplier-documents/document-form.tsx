"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2, Info } from "lucide-react";
import type {
  SupplierDocumentSourceType,
  SupplierOnboardingStepKey,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { Switch } from "@quagga/ui/components/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { toast } from "@quagga/ui/components/toast";

import {
  createSupplierDocument,
  updateSupplierDocument,
} from "@/lib/actions/supplier-documents";
import { BINDABLE_STEPS, UNBOUND_VALUE, asStepKey } from "./steps";

// The add/edit form for a supplier sign-up document (canvas `U7929T` "Add a
// document or link" card; the same body is reused inside the row edit dialog).
//
// ── ON "UPLOAD" ──────────────────────────────────────────────────────────────
// The canvas drew a drag-and-drop dropzone. THIS DEPLOYMENT HAS NO BLOB
// STORAGE, so there is nothing behind an uploader — and a control that looks
// like it accepts a file but silently does nothing is exactly the kind of faked
// capability the accounts-security spec forbids. So the `file` source is what
// it honestly is: the URL of an already-hosted file, plus a plain statement
// that in-app upload isn't available yet.
//
// `file` vs `link` is still a real distinction and is stored: `url` holds the
// address either way, and the source type is what makes the supplier portal
// label the action "Download" rather than "Open" (see @quagga/types
// `SupplierDocumentSourceType`). When blob storage is provisioned, this branch
// gains a real uploader that writes the resulting blob URL into the same field.

export interface DocumentFormValues {
  title: string;
  sourceType: SupplierDocumentSourceType;
  url: string;
  requiredAck: boolean;
  stepKey: SupplierOnboardingStepKey | null;
}

const BLANK: DocumentFormValues = {
  title: "",
  sourceType: "file",
  url: "",
  requiredAck: false,
  stepKey: null,
};

export function DocumentForm({
  mode,
  editionId,
  documentId,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  /** Required when creating — the edition the document is published to. */
  editionId?: string;
  /** Required when editing. */
  documentId?: string;
  initial?: DocumentFormValues;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState<DocumentFormValues>(
    initial ?? BLANK,
  );
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof DocumentFormValues>(
    key: K,
    value: DocumentFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // A bound document MUST require acknowledgement — otherwise nothing would
  // ever complete the step (core rejects the combination). Selecting a step
  // therefore turns the requirement on, and it cannot be turned off while bound.
  function setStep(next: string) {
    const stepKey = next === UNBOUND_VALUE ? null : asStepKey(next);
    setValues((v) => ({
      ...v,
      stepKey,
      requiredAck: stepKey ? true : v.requiredAck,
    }));
  }

  const bound = values.stepKey !== null;
  const canSubmit =
    values.title.trim().length > 0 && values.url.trim().length > 0 && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        title: values.title.trim(),
        sourceType: values.sourceType,
        url: values.url.trim(),
        requiredAck: values.requiredAck,
        stepKey: values.stepKey,
      };

      const result =
        mode === "create"
          ? await createSupplierDocument({
              editionId: editionId ?? "",
              ...payload,
            })
          : await updateSupplierDocument({
              documentId: documentId ?? "",
              ...payload,
            });

      if (!result.ok) {
        toast.error(
          mode === "create"
            ? "Could not add the document"
            : "Could not save the document",
          { description: result.error },
        );
        return;
      }

      toast.success(
        mode === "create" ? "Document published" : "Document updated",
        {
          description:
            "Suppliers see the current list on their onboarding page.",
        },
      );
      if (mode === "create") setValues(BLANK);
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <Field label="Document title" htmlFor="doc-title" required>
        <Input
          id="doc-title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Fire safety guidelines"
          disabled={pending}
          maxLength={160}
          required
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium leading-none text-foreground">
          Source
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          value={values.sourceType}
          onValueChange={(next) => {
            if (next) set("sourceType", next as SupplierDocumentSourceType);
          }}
          disabled={pending}
          aria-label="Document source"
        >
          <ToggleGroupItem value="file" className="flex-1">
            <FileUp className="h-4 w-4" aria-hidden />
            Hosted file
          </ToggleGroupItem>
          <ToggleGroupItem value="link" className="flex-1">
            <Link2 className="h-4 w-4" aria-hidden />
            External link
          </ToggleGroupItem>
        </ToggleGroup>

        {values.sourceType === "file" ? (
          <p className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Uploading files from the console isn&apos;t available yet — this
              deployment has no blob storage. Host the PDF where AfrikaBurn
              already keeps its documents and paste its address below; suppliers
              get a <strong className="font-medium">Download</strong> action for
              it.
            </span>
          </p>
        ) : null}

        <Field
          label={
            values.sourceType === "file" ? "File address" : "Link address"
          }
          htmlFor="doc-url"
          required
          help="Must be a full URL, including https://"
        >
          <Input
            id="doc-url"
            type="url"
            inputMode="url"
            value={values.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder={
              values.sourceType === "file"
                ? "https://www.afrikaburn.org/…/supplier-agreement-2027.pdf"
                : "https://quaggapedia.afrikaburn.com/…"
            }
            disabled={pending}
            maxLength={2048}
            required
          />
        </Field>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium leading-none text-foreground">
            Required acknowledgement
          </p>
          <div className="flex items-center gap-3">
            <Switch
              checked={values.requiredAck}
              onCheckedChange={(next) => set("requiredAck", next)}
              disabled={pending || bound}
              aria-label="Require acknowledgement"
            />
            <span className="text-sm text-muted-foreground">
              {values.requiredAck ? "Must acknowledge" : "Optional reading"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {bound
              ? "Locked on: a document bound to a step has to be acknowledged, or nothing would complete the step."
              : "Required documents carry a tick-box on the supplier's onboarding page."}
          </p>
        </div>

        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium leading-none text-foreground">
            Bind to onboarding step
          </p>
          <Select
            value={values.stepKey ?? UNBOUND_VALUE}
            onValueChange={setStep}
            disabled={pending}
          >
            <SelectTrigger aria-label="Bind to onboarding step">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNBOUND_VALUE}>Not bound</SelectItem>
              {BINDABLE_STEPS.map((step) => (
                <SelectItem key={step.key} value={step.key}>
                  {step.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only steps a supplier completes themselves can be bound. Deposit,
            briefing and registration fee are confirmed by AfrikaBurn — a
            tick-box may never stand in for those.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSubmit}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Add document"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

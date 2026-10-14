"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Paperclip, X } from "lucide-react";
import { RECEIPT_CONTENT_TYPES, RECEIPT_MAX_BYTES } from "@quagga/core";
import type { ReceiptSubjectKind } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

// Receipts on the money page (docs/camp-budget-spec.md): a photo or a PDF,
// uploaded to POST /api/money/receipts AFTER the record it belongs to exists.
// The server sniffs the bytes and decides who may attach; the checks here are
// only there to say "too big" before a slow upload.

const ACCEPT = RECEIPT_CONTENT_TYPES.join(",");
const TOO_BIG = "That receipt is larger than 4 MB. Try a smaller photo.";

/** Upload one receipt. Resolves to null on success, or the error to show. */
export async function uploadReceipt(input: {
  slug: string;
  kind: ReceiptSubjectKind;
  id: string;
  file: File;
}): Promise<string | null> {
  if (input.file.size > RECEIPT_MAX_BYTES) return TOO_BIG;
  const form = new FormData();
  form.append("slug", input.slug);
  form.append("kind", input.kind);
  form.append("id", input.id);
  form.append("file", input.file);
  try {
    const res = await fetch("/api/money/receipts", {
      method: "POST",
      body: form,
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    return typeof body?.error === "string"
      ? body.error
      : "We couldn't save that receipt. Please try again.";
  } catch {
    return "We couldn't reach the server. Please try again.";
  }
}

/** The "Add the receipt" box in a form (M1 add entry, M4 new claim). */
export function ReceiptPicker({
  file,
  onChange,
  enabled,
  audience,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  /** False when the deployment has no blob store: say so, offer nothing. */
  enabled: boolean;
  /** Who may open it, for the help line. */
  audience: string;
  disabled?: boolean;
}) {
  const inputId = React.useId();
  const [error, setError] = React.useState<string | null>(null);

  if (!enabled) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        <ImagePlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Receipt uploads aren&apos;t set up on this deployment yet. Save it
          without the receipt; the money people can ask for it.
        </p>
      </div>
    );
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm">
        <Paperclip className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Remove the receipt"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40"
      >
        <ImagePlus
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          aria-hidden
        />
        <span>
          <span className="block font-medium">Add the receipt</span>
          <span className="block text-xs text-muted-foreground">
            Photo or PDF, up to 4 MB. {audience}
          </span>
        </span>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (picked && picked.size > RECEIPT_MAX_BYTES) {
              setError(TOO_BIG);
              return;
            }
            setError(null);
            onChange(picked);
          }}
        />
      </label>
      {error && (
        <p className="mt-1 text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}

/** "Add receipt" on a record that has none yet (an entry, or your own claim
 * while it waits). Picks a file and uploads it straight away. */
export function AttachReceiptButton({
  slug,
  kind,
  id,
  label = "Add receipt",
}: {
  slug: string;
  kind: ReceiptSubjectKind;
  id: string;
  label?: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onPick(file: File) {
    setBusy(true);
    const error = await uploadReceipt({ slug, kind, id, file });
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Receipt added.");
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Paperclip className="h-4 w-4" aria-hidden />
        )}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) void onPick(picked);
        }}
      />
    </>
  );
}

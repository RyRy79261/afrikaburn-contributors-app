"use client";

import * as React from "react";
import { FileText, Loader2, Paperclip, Plus, X } from "lucide-react";
import {
  MAX_SAFETY_DOCUMENTS,
  SAFETY_DOCUMENT_VALIDITY_LABELS,
  SafetyDocumentInput,
  safetyDocumentValidity,
  type SafetyDocumentValidity,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";

// Safety documents with an expiry date, for artwork + mutant-vehicle
// registration (CREATIVE-017). Uploads through the SAME route as the concept
// images (/api/registration/upload, purpose=safety-document) — no new blob
// provider — with a paste-a-link fallback when Blob is not configured.
//
// The list is part of the form's state and is saved with the registration, so
// it follows the registration's editability: a submitted registration's
// documents are locked with the rest of it.
//
// PRIVATE: the page renders this only for the project's lead/admin, and the
// server re-checks that on every write. The copy says who can see them.

export interface SafetyDocumentValue {
  title: string;
  url: string;
  expiresOn: string;
}

const VALIDITY_VARIANT: Record<
  SafetyDocumentValidity,
  "success" | "warning" | "destructive"
> = {
  valid: "success",
  expires_during_event: "warning",
  expired: "destructive",
};

export function SafetyDocumentsField({
  idPrefix,
  value,
  onChange,
  blobConfigured,
  editionEndDate,
  today,
}: {
  idPrefix: string;
  value: SafetyDocumentValue[];
  onChange: (next: SafetyDocumentValue[]) => void;
  blobConfigured: boolean;
  /** The edition's last day — a document must be in force on it. */
  editionEndDate: string;
  /** Today as `YYYY-MM-DD`, from the server so both renders agree. */
  today: string;
}) {
  const [title, setTitle] = React.useState("");
  const [expiresOn, setExpiresOn] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const full = value.length >= MAX_SAFETY_DOCUMENTS;

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "safety-document");
      const res = await fetch("/api/registration/upload", {
        method: "POST",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast.error("Upload failed", {
          description: data.error ?? "Try pasting a link instead.",
        });
        return;
      }
      setUrl(data.url);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch {
      toast.error("Upload failed", {
        description: "Check your connection or paste a link instead.",
      });
    } finally {
      setUploading(false);
    }
  }

  function add() {
    // The same schema the server action enforces, so what the lead sees
    // refused here is exactly what the server would refuse.
    const parsed = SafetyDocumentInput.safeParse({ title, url, expiresOn });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the document.");
      return;
    }
    setError(null);
    onChange([...value, parsed.data].slice(0, MAX_SAFETY_DOCUMENTS));
    setTitle("");
    setExpiresOn("");
    setUrl("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Safety documents</p>
        <p className="text-xs text-muted-foreground">
          Certificates, engineering sign-offs, a roadworthy — each with the date
          it expires. Only this project&rsquo;s leads and admins and AfrikaBurn
          staff can see them; they never appear on your public page.
        </p>
      </div>

      {value.length > 0 && (
        <ul
          className="flex flex-col divide-y divide-border rounded-lg border border-border"
          aria-label="Attached safety documents"
        >
          {value.map((doc, i) => {
            const validity = safetyDocumentValidity(
              doc.expiresOn,
              { endDate: editionEndDate },
              today,
            );
            return (
              <li
                key={`${doc.url}-${i}`}
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <FileText
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium text-accent underline-offset-4 hover:underline"
                  >
                    {doc.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Expires {doc.expiresOn}
                  </span>
                </div>
                <Badge variant={VALIDITY_VARIANT[validity]}>
                  {SAFETY_DOCUMENT_VALIDITY_LABELS[validity]}
                </Badge>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Remove ${doc.title}`}
                  className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!full && (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Document name" htmlFor={`${idPrefix}-doc-title`}>
              <Input
                id={`${idPrefix}-doc-title`}
                className="min-h-11"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Structural engineer sign-off"
              />
            </Field>
            <Field label="Expires on" htmlFor={`${idPrefix}-doc-expiry`}>
              <Input
                id={`${idPrefix}-doc-expiry`}
                type="date"
                className="min-h-11"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {blobConfigured && (
              <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:text-foreground sm:w-auto">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="h-4 w-4" aria-hidden />
                )}
                {uploading ? "Uploading…" : "Upload file"}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                blobConfigured
                  ? "or paste an https link"
                  : "Paste an https link"
              }
              className="min-h-11 flex-1"
              aria-label="Document link"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={add}
              disabled={uploading}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add document
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A document has to be in force on the event&rsquo;s last day to cover it.
        Up to {MAX_SAFETY_DOCUMENTS}.
      </p>
    </div>
  );
}

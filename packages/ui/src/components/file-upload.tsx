"use client";

import * as React from "react";
import {
  FileText,
  ImagePlus,
  LinkIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@quagga/ui/lib/utils";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";

// Reusable upload primitive backed by Vercel Blob CLIENT uploads
// (`@vercel/blob/client` → `upload()`), so files go browser → Blob directly,
// bypassing the 4.5 MB serverless-body cap and giving real progress. The app's
// `handleUploadUrl` route authenticates the request and — critically — sets the
// server-enforced `allowedContentTypes` + `maximumSizeInBytes` on the issued
// token, so type/size validation is a SERVER boundary, not just this client's
// pre-check. The stored value is always the resulting public blob URL, which is
// why every consumer keeps its existing URL column with no schema change.
//
// Honest degradation: when the deployment has no `BLOB_READ_WRITE_TOKEN` the
// caller passes `blobConfigured={false}` and this renders the URL-paste fallback
// with a plain statement of why — never a dropzone that silently does nothing.

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface FileUploadProps {
  /** Stored public URLs. Single-file callers pass `[]` or `[url]`. */
  value: string[];
  onChange: (urls: string[]) => void;
  /** App route that implements `@vercel/blob` `handleUpload`. */
  handleUploadUrl: string;
  /** False → show only the URL-paste fallback + a "not configured" note. */
  blobConfigured: boolean;
  /** Bucket/policy discriminator, sent as `clientPayload` and used to organise
   *  the blob pathname. The server route maps it to a type/size policy. */
  kind: string;
  /** `image` shows a thumbnail grid; `file` shows a filename chip list. */
  variant?: "image" | "file";
  /** Cap on retained URLs (default 1). Reaching it hides the add controls. */
  maxFiles?: number;
  /** Client-side size pre-check in bytes (the server re-enforces its own cap). */
  maxSizeBytes?: number;
  /** Accepted MIME types (client pre-check + `<input accept>`). Defaults to the
   *  image set for the image variant, or unrestricted for the file variant. */
  acceptedTypes?: string[];
  /** Keep the "or paste a URL" affordance even when Blob is configured
   *  (default true — a hosted asset is always a valid answer). */
  allowUrlPaste?: boolean;
  urlPlaceholder?: string;
  /** Dropzone helper line. */
  hint?: string;
  disabled?: boolean;
  /** Fired after `onChange` has been applied — lets autosave read fresh state. */
  onCommit?: () => void;
  className?: string;
  /** Accessible label for the add control / dropzone. */
  ariaLabel?: string;
}

interface UploadState {
  active: boolean;
  /** 0–100 of the file currently uploading. */
  percentage: number;
  /** Position in a multi-file batch, e.g. "2 of 4". */
  batch: { index: number; total: number } | null;
}

const IDLE: UploadState = { active: false, percentage: 0, batch: null };

export function FileUpload({
  value,
  onChange,
  handleUploadUrl,
  blobConfigured,
  kind,
  variant = "image",
  maxFiles = 1,
  maxSizeBytes = DEFAULT_MAX_BYTES,
  acceptedTypes,
  allowUrlPaste = true,
  urlPlaceholder,
  hint,
  disabled = false,
  onCommit,
  className,
  ariaLabel,
}: FileUploadProps) {
  const [state, setState] = React.useState<UploadState>(IDLE);
  const [dragging, setDragging] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState("");
  const inputId = React.useId();

  const accepts =
    acceptedTypes ?? (variant === "image" ? IMAGE_TYPES : undefined);
  const acceptAttr = accepts?.join(",");
  const full = value.length >= maxFiles;
  const busy = state.active || disabled;

  function commit(next: string[]) {
    onChange(next);
    // Let React flush the new value before a consumer's autosave reads it.
    if (onCommit) setTimeout(onCommit, 0);
  }

  function remove(url: string) {
    commit(value.filter((u) => u !== url));
  }

  function addUrl() {
    const candidate = urlDraft.trim();
    if (!candidate) return;
    try {
      new URL(candidate);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }
    if (value.includes(candidate)) {
      toast.info("That link is already added.");
      return;
    }
    commit([...value, candidate].slice(0, maxFiles));
    setUrlDraft("");
  }

  function validate(file: File): string | null {
    if (accepts && file.type && !accepts.includes(file.type)) {
      return variant === "image"
        ? "Upload a PNG, JPEG, WebP, or GIF image."
        : "That file type isn't allowed here.";
    }
    if (file.size > maxSizeBytes) {
      return `That file is larger than ${formatBytes(maxSizeBytes)}.`;
    }
    return null;
  }

  async function uploadFiles(files: File[]) {
    if (!blobConfigured || files.length === 0) return;
    // Respect the cap; only take as many as there is room for.
    const room = Math.max(0, maxFiles - value.length);
    const batch = files.slice(0, room);
    if (batch.length < files.length) {
      toast.info(
        `Only ${room} more ${room === 1 ? "file fits" : "files fit"} here.`,
      );
    }

    const added: string[] = [];
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      if (!file) continue;
      const problem = validate(file);
      if (problem) {
        toast.error("Couldn't add that file", { description: problem });
        continue;
      }
      setState({
        active: true,
        percentage: 0,
        batch: batch.length > 1 ? { index: i + 1, total: batch.length } : null,
      });
      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
        const blob = await upload(`${kind}/${safeName}`, file, {
          access: "public",
          handleUploadUrl,
          clientPayload: JSON.stringify({ kind }),
          onUploadProgress: ({ percentage }) =>
            setState((s) => ({ ...s, percentage })),
        });
        added.push(blob.url);
      } catch (err) {
        toast.error("Upload failed", {
          description:
            err instanceof Error && err.message
              ? err.message
              : "Check your connection or paste a link instead.",
        });
      }
    }
    setState(IDLE);
    if (added.length > 0) {
      commit([...value, ...added].slice(0, maxFiles));
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy || full) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files);
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {value.length > 0 &&
        (variant === "image" ? (
          <ul
            className={cn(
              "grid gap-3",
              maxFiles > 1 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1",
            )}
          >
            {value.map((url, i) => (
              <li
                key={url}
                className="group relative overflow-hidden rounded-lg border border-border bg-secondary/40"
              >
                {/* Author/uploader-supplied URL: next/image would need host
                    allowlisting we deliberately don't configure. */}
                <img
                  src={url}
                  alt={`Upload ${i + 1}`}
                  className={cn(
                    "w-full object-cover",
                    maxFiles > 1 ? "aspect-square" : "max-h-48",
                  )}
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    aria-label={`Remove upload ${i + 1}`}
                    className="absolute right-1 top-1 rounded-md bg-ab-charcoal/70 p-1 text-ab-warmwhite opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.map((url) => (
              <li
                key={url}
                className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
              >
                <FileText
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-foreground hover:underline"
                >
                  {fileNameFromUrl(url)}
                </a>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    aria-label={`Remove ${fileNameFromUrl(url)}`}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}

      {!full && (
        <div className="flex flex-col gap-2">
          {blobConfigured && (
            <label
              htmlFor={inputId}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              aria-label={ariaLabel ?? "Upload a file"}
              aria-busy={state.active}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors",
                dragging
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-input text-muted-foreground hover:border-primary/60 hover:text-foreground",
                busy && "pointer-events-none opacity-70",
              )}
            >
              {state.active ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <span>
                    {state.batch
                      ? `Uploading ${state.batch.index} of ${state.batch.total}… ${state.percentage}%`
                      : `Uploading… ${state.percentage}%`}
                  </span>
                  <span
                    className="mt-1 h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={state.percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className="block h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${state.percentage}%` }}
                    />
                  </span>
                </>
              ) : (
                <>
                  {variant === "image" ? (
                    <ImagePlus className="h-5 w-5" aria-hidden />
                  ) : (
                    <Upload className="h-5 w-5" aria-hidden />
                  )}
                  <span>
                    <span className="font-medium text-foreground">
                      Click to {variant === "image" ? "add an image" : "upload"}
                    </span>{" "}
                    or drag &amp; drop
                  </span>
                  {hint && <span className="text-xs">{hint}</span>}
                </>
              )}
              <input
                id={inputId}
                type="file"
                accept={acceptAttr}
                multiple={maxFiles > 1}
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void uploadFiles(files);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {(allowUrlPaste || !blobConfigured) && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <LinkIcon
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addUrl();
                    }
                  }}
                  placeholder={
                    urlPlaceholder ??
                    (blobConfigured
                      ? "or paste a link"
                      : "paste a link to the file")
                  }
                  className="pl-8"
                  disabled={disabled}
                  aria-label="Paste a URL"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUrl}
                disabled={disabled}
              >
                Add
              </Button>
            </div>
          )}

          {!blobConfigured && (
            <p className="text-xs text-muted-foreground">
              File uploads aren&apos;t configured on this deployment — paste a
              link to an already-hosted file instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

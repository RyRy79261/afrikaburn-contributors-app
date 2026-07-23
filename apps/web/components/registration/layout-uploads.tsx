"use client";

import * as React from "react";
import { ImagePlus, LinkIcon, Loader2, X } from "lucide-react";
import { MAX_LAYOUT_UPLOADS } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";

// Section 4 layout images (max 4). Uploads to Vercel Blob when the deployment
// has BLOB_READ_WRITE_TOKEN; otherwise the file picker is hidden and a URL
// input is the graceful fallback (build-spec §apps/web). Either path appends a
// public URL to the value array.

export function LayoutUploads({
  urls,
  onChange,
  onCommit,
  blobConfigured,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  onCommit: () => void;
  blobConfigured: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState("");
  const full = urls.length >= MAX_LAYOUT_UPLOADS;

  function commitUrls(next: string[]) {
    onChange(next);
    // Let state flush before the autosave reads it.
    setTimeout(onCommit, 0);
  }

  function remove(url: string) {
    commitUrls(urls.filter((u) => u !== url));
  }

  function addUrl() {
    const value = urlDraft.trim();
    if (!value) return;
    try {
      // Basic URL validation mirrors the server's z.string().url().
      new URL(value);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }
    if (urls.includes(value)) {
      toast.info("That image is already added.");
      return;
    }
    commitUrls([...urls, value].slice(0, MAX_LAYOUT_UPLOADS));
    setUrlDraft("");
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
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
          description: data.error ?? "Try pasting an image URL instead.",
        });
        return;
      }
      commitUrls([...urls, data.url].slice(0, MAX_LAYOUT_UPLOADS));
    } catch {
      toast.error("Upload failed", {
        description: "Check your connection or paste an image URL instead.",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          Layout sketches / plans
        </p>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_LAYOUT_UPLOADS} images of your camp layout. Optional, but it
          helps placement.
        </p>
      </div>

      {urls.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {urls.map((url, i) => (
            <li
              key={url}
              className="group relative overflow-hidden rounded-lg border border-border bg-secondary/40"
            >
              <img
                src={url}
                alt={`Layout ${i + 1}`}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => remove(url)}
                aria-label={`Remove layout ${i + 1}`}
                className="absolute right-1 top-1 rounded-md bg-night/70 p-1 text-bone opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="flex flex-col gap-2">
          {blobConfigured && (
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
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
                placeholder="or paste an image URL"
                className="pl-8"
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addUrl}>
              Add
            </Button>
          </div>
          {!blobConfigured && (
            <p className="text-xs text-muted-foreground">
              File uploads aren&apos;t configured on this deployment — paste a link
              to your layout image instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { MAX_LAYOUT_UPLOADS } from "@quagga/types";
import { FileUpload } from "@quagga/ui/components/file-upload";

// Section 4 layout images (max 4). Delegates to the shared @quagga/ui FileUpload
// primitive: real Vercel Blob client uploads when the deployment has
// BLOB_READ_WRITE_TOKEN, and the URL-paste fallback (with an honest note) when
// it doesn't. Either path appends a public URL to the value array — the stored
// shape is unchanged, so no schema change.

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

      <FileUpload
        value={urls}
        onChange={onChange}
        onCommit={onCommit}
        blobConfigured={blobConfigured}
        handleUploadUrl="/api/blob/upload"
        kind="registration-layouts"
        variant="image"
        maxFiles={MAX_LAYOUT_UPLOADS}
        hint="PNG, JPEG, WebP or GIF, up to 8 MB each"
        ariaLabel="Upload a layout image"
      />
    </div>
  );
}

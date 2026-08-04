import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getAuthenticatedUser } from "@/lib/auth";

// Client-upload token endpoint for the shared `@quagga/ui` FileUpload component.
// The browser calls `upload()` which POSTs here first for a scoped token, then
// streams the file straight to Vercel Blob. This is where TYPE + SIZE become a
// SERVER boundary: `allowedContentTypes` and `maximumSizeInBytes` are baked into
// the token and enforced by Blob during the upload, not merely pre-checked in
// the client. Authn is enforced here too — no token is issued to a signed-out
// caller. When BLOB_READ_WRITE_TOKEN is absent the component never reaches this
// route (it shows the URL-paste fallback), but we still refuse loudly (501).

export const runtime = "nodejs";

const MB = 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const DOC_TYPES = [
  "application/pdf",
  ...IMAGE_TYPES,
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface Policy {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
}

// One policy per upload `kind` (sent as clientPayload). Unknown kinds fall back
// to the most restrictive image policy rather than a permissive default.
const POLICIES: Record<string, Policy> = {
  "registration-layouts": {
    allowedContentTypes: IMAGE_TYPES,
    maximumSizeInBytes: 8 * MB,
  },
  "questionnaire-files": {
    allowedContentTypes: DOC_TYPES,
    maximumSizeInBytes: 25 * MB,
  },
};

const FALLBACK: Policy = {
  allowedContentTypes: IMAGE_TYPES,
  maximumSizeInBytes: 8 * MB,
};

function resolvePolicy(clientPayload: string | null): Policy {
  if (!clientPayload) return FALLBACK;
  try {
    const parsed = JSON.parse(clientPayload) as { kind?: string };
    return (parsed.kind && POLICIES[parsed.kind]) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads aren't configured on this deployment. Paste a link instead.",
      },
      { status: 501 },
    );
  }

  const body = (await request
    .json()
    .catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const user = await getAuthenticatedUser();
        if (!user) throw new Error("Sign in to upload.");
        const policy = resolvePolicy(clientPayload);
        return {
          allowedContentTypes: policy.allowedContentTypes,
          maximumSizeInBytes: policy.maximumSizeInBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      // No onUploadCompleted work: the client receives the blob URL from
      // upload() and writes it into the form field, so there is nothing to
      // reconcile server-side (and Vercel can't call back to localhost anyway).
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

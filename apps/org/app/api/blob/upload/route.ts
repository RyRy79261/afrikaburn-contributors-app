import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireOrgSession } from "@/lib/session";

// Client-upload token endpoint for the org console (supplier documents +
// questionnaire builder images). Mirrors apps/web's route but authorises with
// requireOrgSession — only an org-console user can mint an upload token. Type +
// size are server-enforced via the token (allowedContentTypes / maximumSizeIn
// Bytes); see apps/web/app/api/blob/upload/route.ts for the fuller rationale.

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

const POLICIES: Record<string, Policy> = {
  "supplier-documents": {
    allowedContentTypes: DOC_TYPES,
    maximumSizeInBytes: 25 * MB,
  },
  "questionnaire-images": {
    allowedContentTypes: IMAGE_TYPES,
    maximumSizeInBytes: 8 * MB,
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

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Throws if the caller is not an authorised org-console user. An upload
        // is a console write, so it names that capability rather than settling
        // for "has a session".
        const session = await requireOrgSession({ capability: "write" });
        const policy = resolvePolicy(clientPayload);
        return {
          allowedContentTypes: policy.allowedContentTypes,
          maximumSizeInBytes: policy.maximumSizeInBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.user.id }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

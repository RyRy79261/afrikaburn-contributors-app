import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { OrgDomain } from "@quagga/core";
import { requireOrgSession } from "@/lib/session";

// Client-upload token endpoint for the org console (supplier documents +
// questionnaire builder images). Mirrors apps/web's route but authorises with
// requireOrgSession — only an org-console user can mint an upload token. Type +
// size are server-enforced via the token (allowedContentTypes / maximumSizeIn
// Bytes); see apps/web/app/api/blob/upload/route.ts for the fuller rationale.
//
// EVERY UPLOAD KIND CARRIES ITS OWN DOMAIN. The console's capabilities are
// department-scoped, so "may this account upload?" is meaningless without
// saying WHERE. This route used to authorise every upload against
// `supplier_documents`, whatever it was: a questionnaire author in a department
// that owns questionnaires but not supplier documents was refused an image in
// the builder, while a supplier-documents role was handed a token for a
// questionnaire image. Wrong in both directions, and invisible — the browser
// only ever showed "Upload failed".

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
  /** The console area this upload belongs to — what the capability is checked
   * against. Getting this wrong refuses the right people and admits the wrong
   * ones, so it lives beside the type/size policy rather than at the call. */
  domain: OrgDomain;
}

const POLICIES: Record<string, Policy> = {
  "supplier-documents": {
    allowedContentTypes: DOC_TYPES,
    maximumSizeInBytes: 25 * MB,
    domain: "supplier_documents",
  },
  "questionnaire-images": {
    allowedContentTypes: IMAGE_TYPES,
    maximumSizeInBytes: 8 * MB,
    domain: "questionnaires",
  },
};

/**
 * The policy for a declared upload kind, or null when the caller declared none
 * this build knows.
 *
 * There is no longer a permissive fallback, and that is the point: a fallback
 * policy has no honest domain to authorise against — "some upload, somewhere"
 * is not a question `orgCanInDomain` can answer, and answering it with whatever
 * domain happened to be written at the call site is how every upload came to be
 * checked against supplier documents. `FileUpload` always sends
 * `{ kind }` (it is also the blob pathname prefix), so an absent or unknown
 * kind is a caller this route does not serve.
 */
function resolvePolicy(clientPayload: string | null): Policy | null {
  if (!clientPayload) return null;
  try {
    const parsed = JSON.parse(clientPayload) as { kind?: string };
    return (parsed.kind && POLICIES[parsed.kind]) || null;
  } catch {
    return null;
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
        const policy = resolvePolicy(clientPayload);
        if (!policy) {
          throw new Error("That kind of upload isn't accepted here.");
        }
        // Throws if the caller is not an authorised org-console user. An upload
        // MINTS a new stored object, so it names `create` rather than settling
        // for "has a session" — in the domain that owns what is being uploaded.
        const session = await requireOrgSession({
          capability: "create",
          domain: policy.domain,
        });
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

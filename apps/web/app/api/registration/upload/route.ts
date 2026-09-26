import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentCampUser, pendingBlockingRoute } from "@/lib/session";

// Upload endpoint for the ART PROJECT and MUTANT VEHICLE registration forms —
// concept images/photos, and (purpose=safety-document) safety documents (components/artworks/artwork-registration-form.tsx and
// components/vehicles/vehicle-registration-form.tsx are its only callers — the
// theme-camp wizard uploads through the client-token route /api/blob/upload).
// Uploads to Vercel Blob when BLOB_READ_WRITE_TOKEN is configured; otherwise
// returns 501 so the client falls back to a plain URL input (build-spec §apps/
// web: "Blob layout uploads" with graceful degradation). Never crashes the app.

export const runtime = "nodejs";

const MB = 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * One policy per upload purpose, chosen by the form's `purpose` field.
 *
 * `safety-document` (CREATIVE-017) adds PDF — certificates and engineering
 * sign-offs arrive as PDFs far more often than as photos. Its path prefix is
 * separate so the documents are distinguishable in the store from the public
 * concept images. An unknown or missing purpose gets the IMAGE policy: the
 * most restrictive one, never a permissive default.
 *
 * PRIVACY OF WHAT IS STORED. Like every upload this route has ever made, the
 * blob is written with the store's existing `public` access and an unguessable
 * random suffix; the URL is the capability. Safety documents are private
 * because that URL is only ever projected to the project's lead/admin and to
 * org staff (`registration_safety_documents`, never a public page or export) —
 * NOT because the blob itself refuses an anonymous fetch. Moving these to a
 * private blob store is a deliberate follow-up, not something to assume here.
 */
const POLICIES = {
  image: {
    allowed: new Set(IMAGE_TYPES),
    maxBytes: 8 * MB,
    prefix: "registration-layouts",
    typeError: "Upload a PNG, JPEG, WebP, or GIF image.",
    sizeError: "That image is larger than 8 MB.",
  },
  "safety-document": {
    allowed: new Set(["application/pdf", ...IMAGE_TYPES]),
    maxBytes: 15 * MB,
    prefix: "project-safety-documents",
    typeError: "Upload a PDF, or a PNG, JPEG, WebP or GIF image.",
    sizeError: "That document is larger than 15 MB.",
  },
} as const;

type UploadPurpose = keyof typeof POLICIES;

function resolveUploadPurpose(raw: unknown): UploadPurpose {
  return raw === "safety-document" ? "safety-document" : "image";
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function POST(request: Request): Promise<Response> {
  // Authn AND the hard gate, matching the two pages that own this endpoint
  // (/artworks/new and /vehicles/new both do `ensureCampUser` then redirect on
  // `pendingBlockingRoute`). It previously took any authenticated Neon Auth
  // identity, so a session that the app itself refuses to let past onboarding —
  // including a deleted-and-sanitized account, which `getCurrentCampUser`
  // rejects — could still write public blobs at 8 MB a time. A route handler
  // must not redirect, so the gate is reported as a 403 the form can show.
  const user = await getCurrentCampUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
  }
  if (await pendingBlockingRoute(user.id)) {
    return NextResponse.json(
      { error: "Finish your onboarding before uploading files." },
      { status: 403 },
    );
  }

  if (!isBlobConfigured()) {
    return NextResponse.json(
      {
        error:
          "File uploads aren't configured on this deployment. Paste an image URL instead.",
      },
      { status: 501 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  const policy = POLICIES[resolveUploadPurpose(form?.get("purpose"))];
  if (file.size > policy.maxBytes) {
    return NextResponse.json({ error: policy.sizeError }, { status: 413 });
  }
  // The allowlist is the ONLY thing standing between this endpoint and an
  // arbitrary public file host, so a part that declares no type fails it rather
  // than skipping it. The old `file.type && !ALLOWED.has(file.type)` let any
  // multipart part with an empty Content-Type — trivial to send by hand, and
  // what several non-browser clients do by default — straight through to a
  // public blob URL, regardless of what it actually contained.
  if (!policy.allowed.has(file.type)) {
    return NextResponse.json({ error: policy.typeError }, { status: 415 });
  }

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    const blob = await put(`${policy.prefix}/${Date.now()}-${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

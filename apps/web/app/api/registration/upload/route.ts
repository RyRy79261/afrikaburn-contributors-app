import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getAuthenticatedUser } from "@/lib/auth";

// Layout-image upload endpoint for the registration wizard (Section 4).
// Uploads to Vercel Blob when BLOB_READ_WRITE_TOKEN is configured; otherwise
// returns 501 so the client falls back to a plain URL input (build-spec §apps/
// web: "Blob layout uploads" with graceful degradation). Never crashes the app.

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function POST(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
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
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That image is larger than 8 MB." },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Upload a PNG, JPEG, WebP, or GIF image." },
      { status: 415 },
    );
  }

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    const blob = await put(`registration-layouts/${Date.now()}-${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

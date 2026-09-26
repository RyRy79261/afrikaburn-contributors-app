import { NextResponse } from "next/server";
import { AVATAR_MAX_BYTES, checkAvatarUpload } from "@quagga/core";
import { getCurrentCampUser, pendingBlockingRoute } from "@/lib/session";
import {
  isAvatarStorageConfigured,
  removeAvatar,
  replaceAvatar,
} from "@/lib/avatar-store";

// The member's OWN profile photo (epic #68): POST uploads/replaces it, DELETE
// removes it (the blob is deleted, not just unlinked). There is no user id in
// the request — a member can only ever act on their own photo.
//
// The upload is buffered and checked by @quagga/core `checkAvatarUpload`: size
// cap first, then the format is SNIFFED from the bytes. The multipart part's
// declared Content-Type is ignored entirely, so an SVG labelled `image/png` is
// refused like any other SVG. Who may later SEE the photo is decided per
// request by `/api/avatar/[userId]`.

export const runtime = "nodejs";

async function authorise(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const user = await getCurrentCampUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in first." }, { status: 401 }),
    };
  }
  if (await pendingBlockingRoute(user.id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Finish your onboarding first." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: user.id };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorise();
  if (!auth.ok) return auth.response;

  // Cheap early refusal on the declared length; the real cap is enforced on
  // the bytes actually read below.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > AVATAR_MAX_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: "That photo is larger than 2 MB. Try a smaller one." },
      { status: 413 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json(
      { error: "That photo is larger than 2 MB. Try a smaller one." },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAvatarUpload(bytes);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Checked AFTER the file is validated on purpose: a refusal of the file
  // itself (SVG, oversize) does not depend on the deployment, so it is the same
  // answer everywhere — including the local e2e stack, which has no blob token.
  if (!isAvatarStorageConfigured()) {
    return NextResponse.json(
      { error: "Photo uploads aren't configured on this deployment." },
      { status: 501 },
    );
  }

  try {
    await replaceAvatar(auth.userId, bytes, check.contentType);
  } catch (err) {
    console.error("[avatar] upload failed", err);
    return NextResponse.json(
      { error: "We couldn't save that photo. Please try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(): Promise<Response> {
  const auth = await authorise();
  if (!auth.ok) return auth.response;
  try {
    await removeAvatar(auth.userId);
  } catch (err) {
    console.error("[avatar] removal failed", err);
    return NextResponse.json(
      { error: "We couldn't remove your photo. Please try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

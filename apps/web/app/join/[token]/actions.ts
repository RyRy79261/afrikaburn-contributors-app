"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  authPathForInvite,
  invitePath,
  isWellFormedInviteToken,
  resolveInviteView,
} from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  ensureCampUser,
  pendingBlockingRoute,
  type CampUser,
} from "@/lib/session";
import { getInvitePreview, previewAsInviteLike } from "@/lib/invites-store";
import { getViewerRole } from "@/lib/groups-store";
import { completeInviteJoin } from "@/lib/invite-flow";
import { clearPendingInvite, setPendingInvite } from "@/lib/pending-invite";

const AcceptInput = z.object({
  token: z.string().refine(isWellFormedInviteToken, "Not an invite token."),
});

/**
 * THE single "I accept this invite" entry point, for every viewer state. It is a
 * plain `<form action>` that always ends in a server-side redirect, so it works
 * with JavaScript disabled and never leaves the browser holding the token.
 *
 * Signed out → remember the invite in an httpOnly cookie and send them to
 * sign-up; `/join/continue` completes the join on the far side.
 * Signed in but gated (Burner Bio / a blocking questionnaire) → remember it and
 * send them to the gate, which resumes here afterwards. The gate is NOT bypassed.
 * Signed in and clear → claim it now and land on the camp.
 *
 * Every branch re-derives the invite's state server-side: the button the browser
 * clicked is a hint, never the authority.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const parsed = AcceptInput.safeParse({ token: formData.get("token") });
  // A malformed token cannot address an invite at all — nothing to show.
  if (!parsed.success) redirect("/directory");
  const { token } = parsed.data;

  const authUser = await getAuthenticatedUser();
  const preview = await getInvitePreview(token);

  // Membership only matters for a signed-in viewer, and only to choose between
  // "join" and "you're already in" — resolve it before deciding anything.
  let user: CampUser | null = null;
  let isMember = false;
  if (authUser) {
    user = await ensureCampUser(authUser);
    if (user && preview) {
      isMember = (await getViewerRole(user.id, preview.groupId)) !== null;
    }
  }

  const view = resolveInviteView(
    preview ? previewAsInviteLike(preview) : null,
    { signedIn: Boolean(user), isMember },
  );

  // Spent, expired or unknown: never mint a pending-invite cookie for a link
  // that cannot be redeemed — re-render the honest state instead.
  if (view.status !== "valid") {
    await clearPendingInvite(token);
    redirect(invitePath(token));
  }

  if (view.cta === "authenticate" || !user) {
    await setPendingInvite(token);
    redirect(authPathForInvite("sign-up"));
  }

  // The hard gate still wins: a blocking action is filled BEFORE the join lands.
  // The invite rides along in the cookie and `/join/continue` finishes it.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) {
    await setPendingInvite(token);
    redirect(gate);
  }

  const result = await completeInviteJoin(token, user);
  await clearPendingInvite(token);
  // A lost race (another redeemer claimed the row first) falls back to the
  // landing page, which now renders the used state — not a dead end.
  redirect(result.ok ? `/camps/${result.slug}` : invitePath(token));
}

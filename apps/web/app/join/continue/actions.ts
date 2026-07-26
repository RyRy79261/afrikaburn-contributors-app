"use server";

import { redirect } from "next/navigation";
import { invitePath } from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { completeInviteJoin } from "@/lib/invite-flow";
import { readPendingInvite, clearPendingInvite } from "@/lib/pending-invite";

/**
 * Finish the invite that survived the authentication round trip.
 *
 * This is a SERVER ACTION, not a GET handler, and that is the whole point. The
 * join writes a membership row, burns a single-use invite and (for a lead
 * transfer) demotes the sitting lead — a state change that must never be
 * reachable by navigation. The pending-invite cookie has to be SameSite=Lax so
 * it survives the top-level GET back from Google's OAuth callback, and Lax
 * cookies ARE sent on cross-site top-level navigations, so as a GET this was
 * triggerable by any third-party page linking to `/join/continue`. As an action
 * it carries Next's origin check, and it only ever runs because a signed-in
 * human pressed the button on the confirm page.
 *
 * The confirm step also fixes WHO redeems. The cookie binds to a browser, not to
 * an account: on a shared laptop, Alice could accept an invite, get bounced to
 * sign-up and wander off, and Bob's session would silently consume her one-time
 * link. Now the page names the account first and Bob has to actively claim it.
 *
 * Every authorisation is re-derived here rather than trusted from the page that
 * rendered the button — the page's checks are for what it shows, these are the
 * ones that decide.
 */
export async function confirmInviteJoinAction(): Promise<void> {
  if (!isDatabaseConfigured()) redirect("/");

  const token = await readPendingInvite();
  if (!token) redirect("/");

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const user = await ensureCampUser(authUser);
  if (!user) redirect("/auth/sign-in");

  // The blocking gate is not bypassed by holding an invite. The cookie survives,
  // so finishing the gate returns here with the invite still pending.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  const result = await completeInviteJoin(token, user);
  await clearPendingInvite(token);

  // On failure (raced, revoked or expired while they were signing up) the
  // landing page renders the honest used/expired state rather than a dead end.
  redirect(result.ok ? `/camps/${result.slug}` : invitePath(token));
}

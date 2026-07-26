import { redirect } from "next/navigation";
import { authPathForInvite } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getInvitePreview } from "@/lib/invites-store";
import { readPendingInvite } from "@/lib/pending-invite";
import { AppShell } from "@/components/app-shell";
import { confirmInviteJoinAction } from "./actions";

// THE far side of the invite's authentication round trip.
//
// A signed-out visitor who accepts an invite is sent through sign-up/sign-in
// with the token in an httpOnly cookie (never a url); everything that finishes
// an auth step — the branded form, Google's OAuth callback, the emailed
// verification link, and the Burner-Bio gate — lands HERE.
//
// It CONFIRMS rather than completing on arrival. Landing on a page must not
// write, and this write is not a small one: a membership row, a burnt one-time
// invite, and for a lead transfer the demotion of the sitting lead. Naming the
// account before the button also stops the shared-browser case, where whoever
// happens to be signed in silently consumes someone else's link.
//
// It doubles as the enumeration fix on the sign-up path. Both outcomes of an
// invite sign-up — a fresh address that gets a session, and an address that
// already has an account and does not — now land on this same url. A signed-out
// arrival is bounced to sign-in, so the two cases are indistinguishable from
// outside, which is the property the enumeration-safe copy on the auth form
// exists to protect and previously lost whenever email verification was off.
//
// `/join/continue` shadows the dynamic `/join/[token]` segment (static segments
// win), which is why "continue" is not a possible token — the grammar in
// @quagga/core has no reserved-word hole.

export const dynamic = "force-dynamic";

export default async function JoinContinuePage() {
  if (!isDatabaseConfigured()) redirect("/");

  // Nothing pending (or a cookie that is not token-shaped): there is no invite
  // to finish, so this page has no business existing for this visitor. The
  // stale cookie is left to expire on its own — a render cannot delete it, and
  // it is httpOnly, single-purpose and short-lived.
  const token = await readPendingInvite();
  if (!token) redirect("/");

  // Still signed out — the auth step did not complete, or was abandoned. Back
  // to sign-in, KEEPING the cookie so a second attempt still works.
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect(authPathForInvite("sign-in"));

  const user = await ensureCampUser(authUser);
  if (!user) redirect("/auth/sign-in");

  // The hard gate is not bypassed by an invite: fill the blocking action first.
  // The cookie survives, and the gate's own completion returns here.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  const preview = await getInvitePreview(token);
  // Spent, revoked or expired while they were signing up — the landing page
  // renders the honest used/expired state rather than a dead end here.
  if (!preview) redirect("/");

  const isTransfer = preview.kind === "lead_transfer";

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-md py-10">
        <Card>
          <CardContent className="flex flex-col gap-[18px] p-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                You&rsquo;re about to join
              </p>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {preview.groupName}
              </h1>
            </div>

            {preview.groupDescription && (
              <p className="text-sm leading-relaxed">
                {preview.groupDescription}
              </p>
            )}

            {isTransfer && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                This link transfers the <strong>lead</strong> role to you.
              </p>
            )}

            {/* Naming the account is the point of this screen: on a shared
                browser the person reading it may not be the person the invite
                was sent to, and a one-time link spent by the wrong account
                cannot be un-spent. */}
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Signed in as{" "}
              <strong className="text-foreground">{user.email}</strong>. This
              invite can only be used once, by this account.
            </p>

            <form action={confirmInviteJoinAction}>
              <Button type="submit" size="lg" className="w-full">
                Join {preview.groupName}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">
              Not you?{" "}
              <a href="/account" className="underline">
                Switch account
              </a>{" "}
              before joining.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

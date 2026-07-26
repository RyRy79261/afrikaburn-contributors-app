import Link from "next/link";
import { ClockAlert, TicketX } from "lucide-react";
import {
  inviteExpiryLabel,
  isWellFormedInviteToken,
  resolveInviteView,
  type InviteView,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { getViewerRole } from "@/lib/groups-store";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  getInvitePreview,
  previewAsInviteLike,
  type InvitePreview,
} from "@/lib/invites-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { JoinButton } from "@/components/join-button";
import { acceptInviteAction } from "./actions";

// `/join/[token]` — the invite landing page (design frames qhcHh + MttcT).
//
// THIS PAGE IS SIGNED-OUT-FIRST BY DESIGN. An invite is sent to someone who does
// not have an account yet; requiring a session to even SEE it made the link
// useless to exactly the person it was minted for. The unguessable token is the
// authorisation to learn which camp is inviting you — and nothing more: no
// roster, no member list, no private field, and (once the link is spent) not
// even the camp's name, which is what keeps a free camp undiscoverable through
// a dead link. Which state renders, and what the button may do, is decided by
// `resolveInviteView` in @quagga/core; the action re-derives all of it
// server-side before it writes anything.
//
// The blocking gate (Burner Bio / a blocking questionnaire) is enforced by the
// ACCEPT ACTION, not by bouncing this page: a gated viewer already sees exactly
// what a signed-out viewer sees, so redirecting them would hide nothing and
// would silently throw the invite away. Clicking Join stores the invite and
// sends them to the gate; `/join/continue` finishes the join afterwards.

export const dynamic = "force-dynamic";

/** Two initials for the inviter avatar; falls back to a generic mark. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The used/expired card — one surface for both, naming no camp (frame). */
function SpentCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"
          aria-hidden
        >
          <ClockAlert className="h-[22px] w-[22px] text-muted-foreground" />
        </span>
        <h1 className="text-lg font-bold">
          This invite has been used or expired
        </h1>
        <p className="text-sm text-muted-foreground">
          Invites are one-time and expire after a week. Your camp lead can send
          you a fresh link.
        </p>
        <Button asChild variant="outline">
          <Link href="/directory">Ask your lead for a new one</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NotFoundCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"
          aria-hidden
        >
          <TicketX className="h-[22px] w-[22px] text-muted-foreground" />
        </span>
        <h1 className="text-lg font-bold">Invite not found</h1>
        <p className="text-sm text-muted-foreground">
          This link isn&rsquo;t valid. Ask the camp for a fresh one.
        </p>
        <Button asChild variant="outline">
          <Link href="/directory">Browse the directory</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** The live-invite card: camp, blurb, inviter, CTA, expiry (frame gKFgC). */
function InviteCard({
  token,
  preview,
  view,
}: {
  token: string;
  preview: InvitePreview;
  view: InviteView;
}) {
  const isTransfer = view.kind === "lead_transfer";
  const label = isTransfer
    ? "Accept lead role"
    : view.cta === "open_camp"
      ? `Open ${preview.groupName}`
      : `Join ${preview.groupName}`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-[18px] p-6">
        {preview.registered && (
          <div>
            <Badge variant="success">Registered</Badge>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            You&rsquo;ve been invited to join
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {preview.groupName}
          </h1>
        </div>

        {preview.groupDescription && (
          <p className="text-sm leading-relaxed">{preview.groupDescription}</p>
        )}

        {isTransfer ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            This link transfers the <strong>lead</strong> role to you.
          </p>
        ) : (
          preview.inviterName && (
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                aria-hidden
              >
                {initials(preview.inviterName)}
              </span>
              <span className="text-sm text-muted-foreground">
                {preview.inviterName} invited you to join.
              </span>
            </div>
          )
        )}

        {/* One form, every viewer state: the action decides between "carry me
            through sign-up", "fill the blocking gate first" and "join now". */}
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <JoinButton label={label} />
        </form>

        {preview.expiresAt && (
          <p className="text-center text-xs text-muted-foreground">
            One-time invite · {inviteExpiryLabel(preview.expiresAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Invite links" />
      </AppShell>
    );
  }

  // A signed-out visitor is the NORMAL case here, so the session read is
  // informational: it picks the call-to-action, it does not guard the page.
  const authUser = await getAuthenticatedUser();
  const user = authUser ? await ensureCampUser(authUser) : null;

  // Never let a malformed segment reach a query.
  const preview = isWellFormedInviteToken(token)
    ? await getInvitePreview(token, (await getActiveEdition())?.id)
    : null;

  const isMember =
    user && preview
      ? (await getViewerRole(user.id, preview.groupId)) !== null
      : false;

  const view = resolveInviteView(
    preview ? previewAsInviteLike(preview) : null,
    { signedIn: Boolean(user), isMember },
  );

  return (
    // Signed out, the frame draws minimal chrome: brand + "Sign in" only. A
    // signed-in viewer keeps the normal nav.
    <AppShell minimalNav>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        {view.status === "not_found" ? (
          <NotFoundCard />
        ) : view.status === "valid" && preview && view.showCamp ? (
          <InviteCard token={token} preview={preview} view={view} />
        ) : (
          <SpentCard />
        )}

        <p className="text-center text-xs text-muted-foreground">
          Joining a camp is free — the platform never holds funds.
        </p>
      </div>
    </AppShell>
  );
}

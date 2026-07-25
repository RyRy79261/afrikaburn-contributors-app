import Link from "next/link";
import { redirect } from "next/navigation";
import { TicketCheck, TicketX } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getInvitePreview } from "@/lib/invites-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { JoinButton } from "@/components/join-button";
import { redeemInviteAction } from "./actions";

export const dynamic = "force-dynamic";

/** Two initials for the inviter avatar; falls back to a generic mark. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "expires in 6 days" / "expires today". */
function expiryLabel(expiresAt: Date): string {
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "expires today";
  if (days === 1) return "expires in 1 day";
  return `expires in ${days} days`;
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

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const user = await ensureCampUser(authUser);
  if (!user) {
    return (
      <AppShell>
        <PreviewNotice feature="Invite links" />
      </AppShell>
    );
  }

  // Onboarding (and any blocking questionnaire) gates joining — the link
  // survives the round trip.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  const edition = await getActiveEdition();
  const preview = await getInvitePreview(token, edition?.id);

  // The redeem action re-validates single-use/expiry server-side; this only
  // decides which state to render.
  const expired =
    preview?.expiresAt != null && preview.expiresAt.getTime() <= Date.now();
  const spent = preview?.usedAt != null || expired;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        {!preview ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <TicketX className="h-8 w-8 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-semibold">Invite not found</h1>
              <p className="text-sm text-muted-foreground">
                This link isn&rsquo;t valid. Ask the camp for a fresh one.
              </p>
              <Button asChild variant="outline">
                <Link href="/directory">Browse the directory</Link>
              </Button>
            </CardContent>
          </Card>
        ) : spent ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <TicketX className="h-8 w-8 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-semibold">
                This invite has been used or expired
              </h1>
              <p className="text-sm text-muted-foreground">
                Invites are one-time and expire after a week. Your camp lead can
                send you a fresh link.
              </p>
              <Button asChild variant="outline">
                <Link href="/directory">Ask your lead for a new one</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <TicketCheck className="h-8 w-8 text-accent" aria-hidden />
              {preview.registered && <Badge variant="success">Registered</Badge>}
              <div>
                <p className="text-sm text-muted-foreground">
                  You&rsquo;ve been invited to join
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                  {preview.groupName}
                </h1>
              </div>

              {preview.groupDescription && (
                <p className="text-sm text-muted-foreground">
                  {preview.groupDescription}
                </p>
              )}

              {preview.kind === "lead_transfer" ? (
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  This link transfers the <strong>lead</strong> role to you.
                </p>
              ) : (
                preview.inviterName && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
                      aria-hidden
                    >
                      {initials(preview.inviterName)}
                    </span>
                    <span>{preview.inviterName} invited you to join.</span>
                  </div>
                )
              )}

              <JoinButton
                token={token}
                label={
                  preview.kind === "lead_transfer"
                    ? "Accept lead role"
                    : `Join ${preview.groupName}`
                }
                action={redeemInviteAction}
              />

              {preview.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  One-time invite · {expiryLabel(preview.expiresAt)}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Joining a camp is free — the platform never holds funds.
        </p>
      </div>
    </AppShell>
  );
}

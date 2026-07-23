import Link from "next/link";
import { redirect } from "next/navigation";
import { TicketCheck } from "lucide-react";
import { firstBlockingAction } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { listRequiredActions } from "@/lib/required-actions";
import { isDatabaseConfigured } from "@/lib/config";
import { getInvitePreview } from "@/lib/invites-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { JoinButton } from "@/components/join-button";
import { redeemInviteAction } from "./actions";

export const dynamic = "force-dynamic";

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

  // Onboarding gates joining — the link survives the round trip.
  const actions = await listRequiredActions(user.id);
  if (firstBlockingAction(actions)) redirect("/onboarding");

  const preview = await getInvitePreview(token);

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <TicketCheck className="h-8 w-8 text-accent" aria-hidden />
            {preview ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">
                    You've been invited to join
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                    {preview.groupName}
                  </h1>
                </div>
                {preview.kind === "lead_transfer" && (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    This link transfers the <strong>lead</strong> role to you.
                  </p>
                )}
                <JoinButton
                  token={token}
                  label={
                    preview.kind === "lead_transfer"
                      ? "Accept lead role"
                      : "Join camp"
                  }
                  action={redeemInviteAction}
                />
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">Invite not found</h1>
                <p className="text-sm text-muted-foreground">
                  This link isn't valid. Ask the camp for a fresh one.
                </p>
                <Button asChild variant="outline">
                  <Link href="/directory">Browse the directory</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import type { OrgSessionState } from "@/lib/session";
import { missingConfig, participantAppUrl } from "@/lib/config";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The full-screen gate — shown to anyone who has not cleared into the console.
 * Renders three honest states: not signed in, signed in but not connected
 * (preview), and signed in without an org role (the polite wall, per canvas
 * T7siQ9 — eyebrow, copy, and a two-button row: participant app + sign out).
 *
 * The full-width QuiltBand + apricot `.org-accent` skin come from the root
 * layout, so this stays a plain centred column (adopting the @quagga/ui
 * GateScreen primitive here would double that shared band — the blocking
 * console-gate depends on it too — so the per-app gate keeps its own shell).
 */
export function GateScreen({
  state,
}: {
  state: Exclude<OrgSessionState, { kind: "ok" }>;
}) {
  const missing = missingConfig();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          {state.kind === "forbidden" ? (
            <Lock className="h-5 w-5" aria-hidden />
          ) : (
            <ShieldCheck className="h-5 w-5" aria-hidden />
          )}
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          AfrikaBurn Organiser Console
        </p>

        {state.kind === "forbidden" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              This side is for AfrikaBurn staff
            </h1>
            <p className="text-sm text-muted-foreground">
              If that&apos;s you, ask a god admin to elevate your account.
              Otherwise, the participant app is where your camp lives.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Restricted to AfrikaBurn staff
            </h1>
            <p className="text-sm text-muted-foreground">
              This console reviews camp registrations and manages accounts.
              Access is limited to accounts with an organiser role.
            </p>
          </>
        )}
      </div>

      {state.kind === "forbidden" ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <a href={participantAppUrl()}>Go to the participant app</a>
            </Button>
            <SignOutButton variant="outline" size="default" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="text-foreground">
              {state.user.primaryEmail ?? "your account"}
            </span>
          </p>
        </>
      ) : (
        <div className="flex items-center justify-center">
          <Button asChild size="lg">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
        </div>
      )}

      {missing.length > 0 && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              aria-hidden
            />
            <div>
              <p className="font-medium text-foreground">
                Preview mode — not yet connected
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Waiting on: {missing.join(", ")}. Sign-in and reviewer tools
                arrive once these are configured.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

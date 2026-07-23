import Link from "next/link";
import { Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import type { OrgSessionState } from "@/lib/session";
import { missingConfig } from "@/lib/config";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The full-screen gate — shown to anyone who has not cleared into the console.
 * Renders three honest states: not signed in, signed in but not connected
 * (preview), and signed in without an org role (polite wall).
 */
export function GateScreen({ state }: { state: Exclude<OrgSessionState, { kind: "ok" }> }) {
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
              This console is for AfrikaBurn staff
            </h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in as{" "}
              <span className="text-foreground">
                {state.user.primaryEmail ?? "your account"}
              </span>
              , but it doesn&apos;t have an organiser role. If you should have
              access, ask a god administrator to elevate you — then reload.
              Otherwise, head back to the participant app.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Restricted to AfrikaBurn staff
            </h1>
            <p className="text-sm text-muted-foreground">
              This console reviews camp registrations, manages accounts, and
              tracks payment references. Access is limited to accounts with an
              organiser role.
            </p>
          </>
        )}
      </div>

      {state.kind === "forbidden" ? (
        <div className="flex items-center justify-center gap-3">
          <SignOutButton variant="outline" size="default" />
          <Button asChild variant="ghost">
            <Link href="/">Reload</Link>
          </Button>
        </div>
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

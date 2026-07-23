import { Lock, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@quagga/ui/components/card";
import { missingConfig } from "@/lib/config";

// STUB gate page (build-spec §apps/org). Wave 1b completes the real auth gate:
// only `god` or `org_staff` memberships may enter; everyone else sees this
// polite wall. For Phase 0 it renders the wall unconditionally.
export const dynamic = "force-dynamic";

export default function OrgGatePage() {
  const missing = missingConfig();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-accent">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Organiser Console
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Restricted to AfrikaBurn staff
        </h1>
        <p className="text-sm text-muted-foreground">
          This console reviews camp registrations, manages accounts, and tracks
          payment references. Access is limited to accounts with an organiser
          role. If that&apos;s you, sign in — otherwise head back to the
          participant app.
        </p>
      </div>

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
                Waiting on: {missing.join(", ")}. The sign-in gate and reviewer
                tools arrive with the org app build.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

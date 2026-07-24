import Link from "next/link";
import { PackageOpen, PackagePlus, TriangleAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import type { SupplierSessionState } from "@/lib/session";
import { missingConfig } from "@/lib/config";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The full-screen gate for anyone who has not resolved into a supplier session.
 * Three honest states: not signed in, signed in but not connected (preview),
 * and signed in without a matching supplier row (sent to the register form on
 * the landing page).
 */
export function GateScreen({
  state,
}: {
  state: Exclude<SupplierSessionState, { kind: "ok" }>;
}) {
  const missing = missingConfig();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          {state.kind === "unlinked" ? (
            <PackagePlus className="h-5 w-5" aria-hidden />
          ) : (
            <PackageOpen className="h-5 w-5" aria-hidden />
          )}
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
          AfrikaBurn Supplier Portal
        </p>

        {state.kind === "unlinked" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Register as a supplier
            </h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in as{" "}
              <span className="text-foreground">
                {state.user.primaryEmail ?? "your account"}
              </span>
              , but we couldn&apos;t match you to a supplier. Register your
              business to start onboarding.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Supplier Portal
            </h1>
            <p className="text-sm text-muted-foreground">
              Complete your Supplier Depot onboarding and track your standing.
              Sign in with the account you registered with — email overlap links
              you to your supplier record automatically.
            </p>
          </>
        )}
      </div>

      {state.kind === "unlinked" ? (
        <div className="flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/">Register your business</Link>
          </Button>
          <SignOutButton variant="outline" size="default" />
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
                Waiting on: {missing.join(", ")}. Sign-in and onboarding tools
                arrive once these are configured.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

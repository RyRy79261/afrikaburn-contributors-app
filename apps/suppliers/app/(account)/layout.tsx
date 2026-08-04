import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageOpen } from "lucide-react";

import {
  githubConfigured,
  transcriptionConfigured,
} from "@quagga/core/report-server";
import { ReportLauncher } from "@quagga/ui/components/report-launcher";

import { getAuthenticatedUser } from "@/lib/auth";
import { resolveSupplierSession } from "@/lib/session";
import { PortalHeader } from "@/components/portal-header";
import { SignOutButton } from "@/components/sign-out-button";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The account suite's shell — and the reason it is a SEPARATE route group from
 * `(portal)` (roadmap M4-21).
 *
 * The portal layout requires a resolved SUPPLIER: an account whose verified
 * email has claimed a listing. That is the right gate for onboarding, documents
 * and standing, and the wrong one for a password. `unlinked` is an ordinary
 * state in this app — somebody signs up, no listing matches their address, and
 * they sit on the register screen — and it must not also mean "you may not
 * change your password or sign out a device you don't recognise". The account
 * exists before the listing does, and outlives it.
 *
 * So the only requirement is a signed-in identity. Each page re-guards before
 * reading, and every read is scoped to that identity by Better Auth itself.
 *
 * THE CHROME still follows the portal when it can: a supplier with a resolved
 * listing gets the familiar header, business name and standing. An account with
 * no listing gets a minimal bar instead — the portal nav would only offer doors
 * that send them back to the gate.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/signin");

  const state = await resolveSupplierSession();

  return (
    <div className="min-h-svh">
      {state.kind === "ok" ? (
        <PortalHeader
          session={{
            user: state.user,
            dbUserId: state.dbUserId,
            supplier: state.supplier,
            edition: state.edition,
            steps: state.steps,
            progress: state.progress,
          }}
        />
      ) : (
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/account" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <PackageOpen className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold tracking-tight">
                  AfrikaBurn
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-primary">
                  Your account
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <p className="hidden max-w-[16rem] truncate text-sm text-muted-foreground sm:block">
                {user.primaryEmail ?? "Signed in"}
              </p>
              <SignOutButton />
            </div>
          </div>
        </header>
      )}
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </div>
      {/* Signed in is the only requirement here, and the only one the reporter
          has either — an account with no console role or no listing can still
          file. */}
      {githubConfigured() && (
        <ReportLauncher dictationEnabled={transcriptionConfigured()} />
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";

import { ReportLauncher } from "@quagga/ui/components/report-launcher";

import { getAuthenticatedUser } from "@/lib/auth";
import { resolveOrgSession, type OrgSession } from "@/lib/session";
import { ConsoleHeader } from "@/components/console-header";
import { SignOutButton } from "@/components/sign-out-button";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The account suite's shell — and the reason it is a SEPARATE route group from
 * `(console)` (roadmap M4-21).
 *
 * The console layout applies two gates that are right for the console and wrong
 * here:
 *
 *  1. NO ORG ROLE, NO ENTRY. Correct for AfrikaBurn's business; wrong for
 *     somebody's own password. An account that has just lost its console role is
 *     an account with a live session on a laptop somewhere, and telling its
 *     owner "you may no longer sign that device out" is the opposite of the
 *     security posture this suite exists for.
 *  2. A PENDING BLOCKING QUESTIONNAIRE REPLACES THE WHOLE CONSOLE. That is a
 *     deliberate hard gate, and this is a deliberate exception to it: a staff
 *     member stuck behind a questionnaire is exactly somebody who might need to
 *     change a password or end a stolen session first. The exception is narrow —
 *     these routes show nothing but the reader's own account.
 *
 * So the only requirement is a signed-in identity. Each page re-guards before
 * reading, and every read is scoped to that identity by Better Auth itself.
 *
 * THE CHROME still follows the console when it can: a staff member with a live
 * session gets the familiar header and nav, because arriving at a stripped-down
 * page is its own small alarm. Someone without a console role gets a minimal bar
 * instead — the console nav would only offer them doors that refuse.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");

  const state = await resolveOrgSession();
  let consoleSession: OrgSession | null = null;
  if (state.kind === "ok") {
    const { kind: _kind, ...rest } = state;
    void _kind;
    consoleSession = rest;
  }

  return (
    <div className="min-h-svh">
      {consoleSession ? (
        <ConsoleHeader session={consoleSession} />
      ) : (
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/account" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Flame className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold tracking-tight">
                  AfrikaBurn
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-accent">
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
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
      {/* Signed in is the only requirement here, and the only one the reporter
          has either — an account with no console role or no listing can still
          file. */}
      <ReportLauncher />
    </div>
  );
}

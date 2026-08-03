import Link from "next/link";
import { Flame } from "lucide-react";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { ReportLauncher } from "@quagga/ui/components/report-launcher";
import { getAuthenticatedUser } from "@/lib/auth";
import { getEditionLabel } from "@/lib/edition";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { SignOutButton } from "./sign-out-button";
import { HeaderNotificationBell } from "./header-notification-bell";
import { NavLink } from "./nav-link";

/**
 * App chrome: brand nav, the edition banner, and the page body. Server
 * component — reads the session cheaply and degrades gracefully env-less.
 *
 * Rendered from `app/(app)/layout.tsx`, not from each page. That is the whole
 * point: React keeps a layout MOUNTED across client-side navigations inside its
 * group, so the header, nav and edition banner survive a route change and only
 * the page body swaps. Rendered per-page (as it was), every click re-ran these
 * three reads, re-sent the entire header down the wire, and let the root
 * `loading.tsx` replace the whole screen — the header visibly blinked on every
 * navigation.
 *
 * The three reads below are AWAITED, not streamed behind `<Suspense>`, and that
 * is deliberate. React delivers a resolved Suspense boundary as a hidden `<div>`
 * plus an inline `$RC(…)` script that moves it into place — so with JavaScript
 * off the boundary never resolves and the visitor is left looking at the
 * fallback. Streaming this nav was tried and reverted after reading the actual
 * response: with `<script>` tags stripped, the "Directory" and "Sign in" links
 * sat inside `<div hidden id="S:0">` and the header showed placeholder bars.
 * Nothing a reader needs in order to navigate may wait on JavaScript. Awaiting
 * costs little and costs it once per FULL page load: these reads are
 * request-`cache()`d (shared with the page's own session read), and a
 * client-side navigation does not re-render this layout at all.
 *
 * `minimalNav` is for the signed-out-friendly surfaces the design draws with
 * nothing but the brand and "Sign in" (the invite landing page, frames qhcHh +
 * MttcT): a stranger arriving on a one-purpose page should be offered that one
 * purpose, not the whole app's navigation. It only ever affects SIGNED-OUT
 * viewers; a signed-in visitor keeps the full nav wherever they are.
 *
 * `gatedNav` is the opposite case and DOES apply to a signed-in viewer: someone
 * held by the hard gate is offered the brand and a way out of the account, and
 * nothing else. Hoisting this shell into the layout is what made the flag
 * necessary — the gate page draws its own stripped header on the assumption
 * that it owns the screen, and until this flag existed the full nav rendered
 * above it. See `viewerIsGated` in lib/session.ts.
 */
export async function AppShell({
  children,
  minimalNav = false,
  gatedNav = false,
}: {
  children: React.ReactNode;
  minimalNav?: boolean;
  gatedNav?: boolean;
}) {
  const user = await getAuthenticatedUser();
  const showBrowseLinks = (!minimalNav || Boolean(user)) && !gatedNav;
  // Both are request-scoped: the edition row is the same for everyone and the
  // camp-user upsert behind the unread count is shared with the page.
  const [editionLabel, unread] = await Promise.all([
    getEditionLabel(),
    user ? getUnreadNotificationCount() : 0,
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <QuiltBand />
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Flame className="h-5 w-5 text-primary" aria-hidden />
            <span className="tracking-tight">Contributors</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            {showBrowseLinks && (
              <>
                <NavLink href="/directory" icon="directory" label="Directory" />
                <NavLink
                  href="/camps/new"
                  icon="create-camp"
                  label="Create camp"
                />
              </>
            )}
            {user ? (
              <>
                {!gatedNav && (
                  <>
                    <NavLink href="/profile" icon="profile" label="Profile" />
                    <NavLink href="/account" icon="account" label="Account" />
                    <HeaderNotificationBell count={unread} />
                  </>
                )}
                <SignOutButton />
              </>
            ) : (
              <Link
                href="/auth/sign-in"
                className="font-medium text-foreground transition-colors hover:text-primary"
              >
                Sign in
              </Link>
            )}
          </div>
        </nav>
        <div className="border-t border-border bg-card/40">
          <p className="mx-auto w-full max-w-5xl px-6 py-1.5 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {editionLabel}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </div>

      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-5xl px-6 py-4 text-xs text-muted-foreground">
          The platform never holds funds — where money applies, we track a
          reference and AfrikaBurn collects.
        </p>
      </footer>

      {/* Signed in only: filing needs a session, and offering the control to
          somebody the endpoint would refuse is worse than not offering it. It
          stays for a GATED viewer — being held by the gate is a thing worth
          reporting, and frequently the reason somebody is reporting. */}
      {user && <ReportLauncher />}
    </div>
  );
}

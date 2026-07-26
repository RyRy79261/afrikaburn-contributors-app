import Link from "next/link";
import { Flame, Compass, TentTree, UserRound, Settings } from "lucide-react";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { getAuthenticatedUser } from "@/lib/auth";
import { getEditionLabel } from "@/lib/edition";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { SignOutButton } from "./sign-out-button";
import { HeaderNotificationBell } from "./header-notification-bell";

/**
 * App chrome: brand nav, the edition banner, and the page body. Server
 * component — reads the session cheaply and degrades gracefully env-less.
 *
 * `minimalNav` is for the signed-out-friendly surfaces the design draws with
 * nothing but the brand and "Sign in" (the invite landing page, frames qhcHh +
 * MttcT): a stranger arriving on a one-purpose page should be offered that one
 * purpose, not the whole app's navigation. It only ever affects SIGNED-OUT
 * viewers; a signed-in visitor keeps the full nav wherever they are.
 */
export async function AppShell({
  children,
  minimalNav = false,
}: {
  children: React.ReactNode;
  minimalNav?: boolean;
}) {
  const user = await getAuthenticatedUser();
  const showBrowseLinks = !minimalNav || Boolean(user);
  const editionLabel = await getEditionLabel();
  // Signed-in only: the bell renders in the header; count is a placeholder
  // seam until the notifications backend lands (see lib/notifications.ts).
  const unread = user ? await getUnreadNotificationCount() : 0;

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
                <Link
                  href="/directory"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Compass className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Directory</span>
                </Link>
                <Link
                  href="/camps/new"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <TentTree className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Create camp</span>
                </Link>
              </>
            )}
            {user ? (
              <>
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <UserRound className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Profile</span>
                </Link>
                <Link
                  href="/account"
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Settings className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Account</span>
                </Link>
                <HeaderNotificationBell count={unread} />
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

      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</div>

      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-5xl px-6 py-4 text-xs text-muted-foreground">
          The platform never holds funds — where money applies, we track a
          reference and AfrikaBurn collects.
        </p>
      </footer>
    </div>
  );
}

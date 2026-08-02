import Link from "next/link";
import { PackageOpen, UserRound } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { standingLabel, standingTone } from "@quagga/core";
import type { SupplierSession } from "@/lib/session";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { HeaderNotificationBell } from "@/components/header-notification-bell";
import { getUnreadNotificationCount } from "@/lib/notifications";

const NAV_ITEMS: NavItem[] = [
  { href: "/onboarding", label: "Onboarding" },
  { href: "/standing", label: "My standing" },
  { href: "/notifications", label: "Notifications" },
];

/**
 * The portal's distinct chrome. The sage-accent brand-mark + "Supplier Portal"
 * wordmark keep it unmistakably separate from the participant and organiser
 * apps. Carries the supplier's business name and current standing.
 */
export async function PortalHeader({ session }: { session: SupplierSession }) {
  const { standing, category, returning } = session.supplier;
  // Real per-user unread count, scoped to the gated supplier account.
  const unread = await getUnreadNotificationCount(session.dbUserId);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/onboarding" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PackageOpen className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">
                AfrikaBurn
              </span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-primary">
                Supplier Portal
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[16rem] truncate text-sm text-foreground">
                {session.supplier.name}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center justify-end gap-1">
                {category && <Badge variant="secondary">{category}</Badge>}
                {returning && (
                  <Badge variant="outline">
                    {returning === "returning" ? "Returning" : "Newbie"}
                  </Badge>
                )}
                <Badge variant={standingTone(standing)}>
                  {standingLabel(standing)}
                </Badge>
              </div>
            </div>
            {/* Awaited, not streamed. A resolved `<Suspense>` boundary is
                delivered as a hidden div plus an inline `$RC(…)` script, so with
                JavaScript off the visitor keeps the fallback forever — a bell
                that permanently claims "none unread". The count is one indexed
                query and the layout is not re-rendered on client-side
                navigation, so awaiting it costs a full page load, once. */}
            <HeaderNotificationBell count={unread} />
            {/* Personal, not the business — so it sits beside sign-out rather
                than in the nav below, which is all about the listing. It is the
                only way into two-factor and passkeys for a supplier, so it
                cannot live behind a menu nobody opens. */}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/account" aria-label="Your account">
                <UserRound className="h-4 w-4" aria-hidden />
                <span className="sr-only sm:not-sr-only sm:ml-2">Account</span>
              </Link>
            </Button>
            <SignOutButton />
          </div>
        </div>

        <PortalNav items={NAV_ITEMS} />
      </div>
    </header>
  );
}

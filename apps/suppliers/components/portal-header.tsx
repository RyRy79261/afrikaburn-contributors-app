import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { standingLabel } from "@quagga/core";
import type { SupplierSession } from "@/lib/session";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { SignOutButton } from "@/components/sign-out-button";

const NAV_ITEMS: NavItem[] = [
  { href: "/onboarding", label: "Onboarding" },
  { href: "/standing", label: "My standing" },
];

/**
 * The portal's distinct chrome. The sage-accent brand-mark + "Supplier Portal"
 * wordmark keep it unmistakably separate from the participant and organiser
 * apps. Carries the supplier's business name and current standing.
 */
export function PortalHeader({ session }: { session: SupplierSession }) {
  const standing = session.supplier.standing;
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
              <Badge
                variant={
                  standing === "good"
                    ? "success"
                    : standing === "watch"
                      ? "warning"
                      : "destructive"
                }
                className="mt-0.5"
              >
                {standingLabel(standing)}
              </Badge>
            </div>
            <SignOutButton />
          </div>
        </div>

        <PortalNav items={NAV_ITEMS} />
      </div>
    </header>
  );
}

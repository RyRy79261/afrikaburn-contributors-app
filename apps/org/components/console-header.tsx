import Link from "next/link";
import { Flame } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import type { OrgSession } from "@/lib/session";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { ConsoleNav, type NavItem } from "@/components/console-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { HeaderNotificationBell } from "@/components/header-notification-bell";

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/status", label: "Status board" },
  { href: "/registrations", label: "Registrations" },
  { href: "/questionnaires", label: "Questionnaires" },
  { href: "/bulletins", label: "Bulletins" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/categories", label: "Categories" },
  { href: "/accounts", label: "Accounts" },
];

/**
 * The console's distinct chrome. The ochre accent brand-mark + "Organiser
 * Console" wordmark keep it unmistakably separate from the participant app.
 */
export async function ConsoleHeader({ session }: { session: OrgSession }) {
  // Signed-in only: the bell lives in the header. Real per-user unread count,
  // scoped to the gated staff member (see lib/notifications.ts).
  const unread = await getUnreadNotificationCount(session.dbUserId);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Flame className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">
                AfrikaBurn
              </span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-accent">
                Organiser Console
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[16rem] truncate text-sm text-foreground">
                {session.user.primaryEmail ?? "Signed in"}
              </p>
              <Badge
                variant={session.role === "god" ? "default" : "secondary"}
                className="mt-0.5"
              >
                {session.role === "god" ? "Owner" : "Org staff"}
              </Badge>
            </div>
            <HeaderNotificationBell count={unread} />
            <SignOutButton />
          </div>
        </div>

        <ConsoleNav items={NAV_ITEMS} />
      </div>
    </header>
  );
}

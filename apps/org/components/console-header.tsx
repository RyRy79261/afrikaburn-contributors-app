import Link from "next/link";
import { Flame } from "lucide-react";
import {
  ORG_RANK_LABELS,
  orgCan,
  runsDeployment,
  type OrgCapability,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import type { OrgSession } from "@/lib/session";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { ConsoleNav, type NavItem } from "@/components/console-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { HeaderNotificationBell } from "@/components/header-notification-bell";

/**
 * A nav entry, optionally gated on a capability from the ONE matrix.
 *
 * Hiding is never the security boundary — `/system` re-checks `read_system`
 * server-side and refuses out loud — but an entry that leads somewhere the
 * viewer will be refused is its own defect, and both read the same predicate so
 * the two cannot drift.
 *
 * Almost nothing here is gated on purpose: every rank reads the whole console,
 * and pages where a rank loses only the CONTROLS (categories, accounts) stay in
 * the nav because they still have something to say to that rank.
 */
type ConsoleNavItem = NavItem & {
  capability?: OrgCapability;
  /** Rank-gated instead: the system panel is IT work, not departmental work. */
  runsDeployment?: true;
};

const NAV_ITEMS: ConsoleNavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/status", label: "Status board" },
  { href: "/registrations", label: "Registrations" },
  { href: "/questionnaires", label: "Questionnaires" },
  { href: "/bulletins", label: "Bulletins" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/categories", label: "Categories" },
  { href: "/accounts", label: "Accounts" },
  // Departments, roles and what each may do live INSIDE the System panel
  // (`/system/roles`) rather than on this bar: editing the permission model is
  // the same job as the auth configuration and the org-access roster beside it,
  // and `/system`'s own entry already carries the whole panel here.
  // The audit trail is not a nice-to-have here: it is the ONLY compensating
  // control over medical-note enumeration. The read path deliberately fails
  // open (an emergency read must never wait on a log write), so detection
  // depends entirely on a human opening this page. Unreachable, the whole
  // control is decorative — which is exactly what supplier sign-up management
  // shipped as until someone noticed.
  { href: "/audit", label: "Audit" },
  // IT's surface: how the deployment is configured and whether it is answering.
  // Engineer and System manager only — org staff hold every other capability on
  // this bar and not this one, which is the clearest illustration that the ranks
  // are different jobs rather than tiers.
  { href: "/system", label: "System", runsDeployment: true },
];

/**
 * The console's distinct chrome. The ochre accent brand-mark + "Organiser
 * Console" wordmark keep it unmistakably separate from the participant app.
 */
export async function ConsoleHeader({ session }: { session: OrgSession }) {
  // Real per-user unread count, scoped to the gated staff member.
  const unread = await getUnreadNotificationCount(session.dbUserId);

  // Resolved server-side against the same matrix the pages guard on. The client
  // nav never learns a capability exists — it receives the list it may show.
  const navItems: NavItem[] = NAV_ITEMS.filter(
    (item) =>
      (!item.capability || orgCan(session.actor, item.capability)) &&
      (!item.runsDeployment || runsDeployment(session.actor)),
  ).map(({ href, label }) => ({ href, label }));

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
              {/* The badge names the DOOR this account came in through. What it
                  may actually do is the line under it: the org roles it holds,
                  which is what `orgCan` resolves. A System manager holds none
                  and needs none — the anchor covers everything. */}
              <Badge
                variant={session.role === "god" ? "default" : "secondary"}
                className="mt-0.5"
              >
                {ORG_RANK_LABELS[session.role]}
              </Badge>
              {session.role !== "god" && (
                <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground">
                  {session.actor.roles.length === 0
                    ? "No org roles yet"
                    : session.actor.roles.map((r) => r.name).join(" · ")}
                </p>
              )}
            </div>
            {/* Awaited, not streamed. A resolved `<Suspense>` boundary is
                delivered as a hidden div plus an inline `$RC(…)` script, so with
                JavaScript off the visitor keeps the fallback forever — a bell
                that permanently claims "none unread". The count is one indexed
                query and the layout is not re-rendered on client-side
                navigation, so awaiting it costs a full page load, once. */}
            <HeaderNotificationBell count={unread} />
            <SignOutButton />
          </div>
        </div>

        <ConsoleNav items={navItems} />
      </div>
    </header>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";
import { Compass, Settings, TentTree, UserRound } from "lucide-react";
import { cn } from "@quagga/ui/lib/utils";

/**
 * A header nav link that admits it was clicked.
 *
 * Every destination in this app is a `force-dynamic`, per-user server render, so
 * the router cannot hand back the page from a prefetch — the click is followed
 * by a real round trip. Without feedback ON THE CONTROL PRESSED, that gap reads
 * as "nothing happened", which is precisely the complaint. Next's
 * `useLinkStatus` gives us the router's own pending state, so the affordance can
 * never disagree with the navigation actually in flight.
 *
 * `prefetch` is left at its default (`auto`) deliberately. For a dynamic route
 * that means "prefetch down to the nearest `loading.tsx`" — which is why every
 * destination in the group now has one: the skeleton is already in the client
 * when the click lands, so it paints with no network at all. `prefetch={true}`
 * would instead force a FULL per-user server render of every nav destination in
 * the viewport, on every page, to save nothing the loading boundary does not
 * already cover.
 *
 * The icon arrives as a KEY, not as a component. Lucide icons are `forwardRef`
 * objects and a server component cannot serialise one across the boundary into a
 * client component — passing it builds and typechecks cleanly and then throws
 * "Functions cannot be passed directly to Client Components" on the first real
 * request. The map lives here, on the client side of the line.
 */
const ICONS = {
  directory: Compass,
  "create-camp": TentTree,
  profile: UserRound,
  account: Settings,
} as const;

export type NavIcon = keyof typeof ICONS;

export function NavLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: NavIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      <NavLinkBody icon={icon} label={label} />
    </Link>
  );
}

function NavLinkBody({ icon, label }: { icon: NavIcon; label: string }) {
  // Must be a DESCENDANT of <Link> — useLinkStatus reads the nearest link's
  // transition, so it cannot live in the component that renders the link.
  const { pending } = useLinkStatus();
  const Icon = ICONS[icon];
  return (
    <>
      <Icon
        className={cn(
          "h-4 w-4 transition-opacity",
          pending && "animate-pulse opacity-60",
        )}
        aria-hidden
      />
      <span className={cn("hidden sm:inline", pending && "opacity-60")}>
        {label}
      </span>
      {pending && <span className="sr-only">Loading {label}…</span>}
    </>
  );
}

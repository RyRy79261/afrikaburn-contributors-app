"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@quagga/ui/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The label, plus the router's own pending state for THIS link.
 *
 * Every console page is a per-user server render, so a click is always followed
 * by a real round trip. `useLinkStatus` has to read it from inside the `<Link>`,
 * which is why this is its own component. The `loading.tsx` boundary covers the
 * page body; this covers the control that was actually pressed, so the nav item
 * itself confirms the click landed.
 */
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn(
        "transition-opacity",
        pending && "animate-pulse opacity-70",
      )}
    >
      {label}
      {pending && <span className="sr-only"> — loading</span>}
    </span>
  );
}

/** Primary console nav with active-route highlighting (ochre accent). */
export function ConsoleNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Console">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <NavLabel label={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}

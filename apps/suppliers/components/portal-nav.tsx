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
 * The label plus this link's own pending state. `useLinkStatus` reads the
 * nearest `<Link>`'s transition, so it must live inside one — hence a separate
 * component. The route's `loading.tsx` covers the page body; this covers the
 * control that was pressed.
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

/** Primary portal nav with active-route highlighting (sage/olive accent). */
export function PortalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap items-center gap-1"
      aria-label="Supplier portal"
    >
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
                ? "bg-primary/15 text-primary"
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

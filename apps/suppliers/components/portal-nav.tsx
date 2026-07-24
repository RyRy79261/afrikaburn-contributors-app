"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@quagga/ui/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/** Primary portal nav with active-route highlighting (sage/olive accent). */
export function PortalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Supplier portal">
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

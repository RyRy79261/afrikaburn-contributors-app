import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@quagga/ui/lib/utils";

// One filter chip: a link that keeps the filter in the URL.

export function TeamChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-input hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

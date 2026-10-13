import Link from "next/link";
import { BarChart3, ReceiptText, Users } from "lucide-react";
import { moneyPath, type MoneyTab } from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

// The money people's tabs (M1–M3). Links, not client tabs: each tab is its
// own server render, so a tab loads only the rows it shows.

const TABS: { key: MoneyTab; label: string; icon: typeof BarChart3 }[] = [
  { key: "budget", label: "Budget", icon: BarChart3 },
  { key: "dues", label: "Dues", icon: Users },
  { key: "claims", label: "Claims", icon: ReceiptText },
];

export function MoneyNav({
  slug,
  active,
  claimsWaiting,
}: {
  slug: string;
  active: MoneyTab;
  /** Claims waiting for a decision (the badge on "Claims"). */
  claimsWaiting: number;
}) {
  return (
    <nav
      aria-label="Money"
      className="flex gap-1 overflow-x-auto border-b border-border pb-3"
    >
      {TABS.map(({ key, label, icon: Icon }) => (
        <Link
          key={key}
          href={moneyPath(slug, key)}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === key
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
          {key === "claims" && claimsWaiting > 0 && (
            <span
              className="rounded-full bg-primary/20 px-1.5 text-xs text-primary"
              aria-label={`${claimsWaiting} waiting`}
            >
              {claimsWaiting}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

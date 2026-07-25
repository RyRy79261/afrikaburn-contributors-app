import Link from "next/link";
import { cn } from "@quagga/ui/lib/utils";
import { AppShell } from "@/components/app-shell";

// Chrome shared by /account, /account/security and /account/delete (canvas
// frames SjInE, G35eq, Q3pQj6): the "YOUR ACCOUNT" eyebrow, the page title, and
// the three-way section nav.
//
// A plain <nav> of links rather than a Tabs component: these are separate
// routes, so the active state must survive a full page load and each entry has
// to be a real, shareable, crawlable URL.

export type AccountSection = "manage" | "security" | "delete";

const SECTIONS: { key: AccountSection; label: string; href: string }[] = [
  { key: "manage", label: "Manage", href: "/account" },
  { key: "security", label: "Security", href: "/account/security" },
  { key: "delete", label: "Delete", href: "/account/delete" },
];

export function AccountShell({
  active,
  title,
  description,
  children,
}: {
  active: AccountSection;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Your account
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <nav
            aria-label="Account sections"
            className="inline-flex w-fit items-center gap-1 rounded-md bg-muted p-1"
          >
            {SECTIONS.map((section) => {
              const current = section.key === active;
              return (
                <Link
                  key={section.key}
                  href={section.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                    current
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {section.label}
                </Link>
              );
            })}
          </nav>
          <p className="text-xs text-muted-foreground">
            One AfrikaBurn account, whichever door you come in by — participant,
            organiser or supplier.
          </p>
        </div>

        {children}

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          These settings sit behind your Burner profile. What you look like to
          other burners lives on{" "}
          <Link href="/profile" className="text-primary hover:underline">
            your profile
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}

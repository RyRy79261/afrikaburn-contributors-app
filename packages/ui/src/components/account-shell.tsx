import { cn } from "@quagga/ui/lib/utils";

// Chrome shared by every account surface in all three apps (roadmap M4-21):
// the "YOUR ACCOUNT" eyebrow, the page title, and the section nav.
//
// A plain <nav> of links rather than a Tabs component: these are separate
// routes, so the active state must survive a full page load and each entry has
// to be a real, shareable URL.
//
// PLAIN <a>, NOT next/link, because @quagga/ui takes no dependency on Next —
// the same rule the pinned-bulletin banner already follows. It costs a full
// navigation between account tabs, which is the correct trade for a package
// three apps import: a shared component that reaches for one app's router is a
// shared component only until the next app.
//
// SECTIONS ARE PASSED IN, not hardcoded. The three apps do not offer the same
// set — the participant app owns deletion, and the other two link out to it —
// and a component that decided this itself would be deciding product policy for
// apps it cannot see.

export interface AccountSectionLink {
  key: string;
  label: string;
  href: string;
}

export function AccountShell({
  sections,
  active,
  title,
  description,
  eyebrow = "Your account",
  /**
   * The one-line reassurance under the nav. Defaulted rather than required
   * because it is the same sentence in all three apps, and it is only TRUE
   * because the suite now exists in all three.
   */
  note = "One AfrikaBurn account, whichever door you come in by — participant, organiser or supplier.",
  footer,
  children,
}: {
  sections: readonly AccountSectionLink[];
  active: string;
  title: string;
  description: string;
  eyebrow?: string;
  note?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
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
          {sections.map((section) => {
            const current = section.key === active;
            return (
              <a
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
              </a>
            );
          })}
        </nav>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>

      {children}

      {footer ? (
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

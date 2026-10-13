import Link from "next/link";
import { cn } from "@quagga/ui/lib/utils";

// The tabs under a registration's header (frame W2): the registration itself,
// its Work Access Passes, and its members (the roster card on the registration
// page). Links, not client tabs — each tab is its own route, so a reviewer can
// share the URL of the panel they are looking at.

export type RegistrationTab = "registration" | "passes";

export function RegistrationTabs({
  registrationId,
  current,
}: {
  registrationId: string;
  current: RegistrationTab;
}) {
  const tabs: {
    key: RegistrationTab | "members";
    label: string;
    href: string;
  }[] = [
    {
      key: "registration",
      label: "Registration",
      href: `/registrations/${registrationId}`,
    },
    {
      key: "passes",
      label: "Work Access Passes",
      href: `/registrations/${registrationId}/passes`,
    },
    {
      key: "members",
      label: "Members",
      href: `/registrations/${registrationId}#members`,
    },
  ];
  return (
    <nav
      aria-label="Registration sections"
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1"
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

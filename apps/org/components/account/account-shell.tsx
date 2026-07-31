import Link from "next/link";
import {
  AccountShell as SharedAccountShell,
  type AccountSectionLink,
} from "@quagga/ui/components/account-shell";

// The console's account chrome — the shared shell (@quagga/ui, roadmap M4-21)
// with the console's own sections.
//
// Three tabs, same as the participant app, but the Delete one explains itself
// and hands over rather than acting: deletion has one implementation and it
// lives where the eligibility checks, the grace period and the sweeper are. A
// missing tab would have read as "an organiser account cannot be deleted",
// which is false.

export type AccountSection = "manage" | "security" | "delete";

const SECTIONS: readonly AccountSectionLink[] = [
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
    <SharedAccountShell
      sections={SECTIONS}
      active={active}
      title={title}
      description={description}
      footer={
        <>
          These are your personal sign-in settings, not AfrikaBurn&rsquo;s. What
          you may do in the console is decided by your org roles —{" "}
          <Link href="/" className="text-primary hover:underline">
            back to the console
          </Link>
          .
        </>
      }
    >
      {children}
    </SharedAccountShell>
  );
}

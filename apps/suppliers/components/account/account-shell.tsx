import Link from "next/link";
import {
  AccountShell as SharedAccountShell,
  type AccountSectionLink,
} from "@quagga/ui/components/account-shell";

// The portal's account chrome — the shared shell (@quagga/ui, roadmap M4-21)
// with the portal's own sections.
//
// The footer draws the line this app most needs drawn: these settings are about
// the PERSON signing in, not the BUSINESS. A supplier's standing, documents and
// onboarding belong to the listing and are managed elsewhere in the portal;
// what lives here is a password, a second factor and a list of devices.

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
          These are your personal sign-in settings, not your business&rsquo;s.
          Your standing, documents and onboarding live on{" "}
          <Link href="/onboarding" className="text-primary hover:underline">
            the portal
          </Link>
          .
        </>
      }
    >
      {children}
    </SharedAccountShell>
  );
}

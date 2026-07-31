import Link from "next/link";
import {
  AccountShell as SharedAccountShell,
  type AccountSectionLink,
} from "@quagga/ui/components/account-shell";

// The participant app's account chrome — the shared shell (@quagga/ui, roadmap
// M4-21) with THIS app's sections and footer.
//
// The participant app is the only one of the three that offers all three
// sections, because it is the only one that owns deletion: the org console and
// the supplier portal carry a Delete tab that explains itself and links back
// here. That difference is exactly why the section list is a prop.
//
// `account/loading.tsx` mirrors this shape, which is why switching account tabs
// does not blank the page.

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
          These settings sit behind your Burner profile. What you look like to
          other burners lives on{" "}
          <Link href="/profile" className="text-primary hover:underline">
            your profile
          </Link>
          .
        </>
      }
    >
      {children}
    </SharedAccountShell>
  );
}

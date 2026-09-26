import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The header the registration's read-only companions share (past registrations,
// what changed). Same shape as the workspace's own header — back-link, eyebrow,
// title — so moving between them does not reflow the page.

export function RegistrationSubpageHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  children,
}: {
  backHref: string;
  backLabel: string;
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </header>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The Shifts pages' header: a back link, the title, one line of copy and an
// optional action cluster (canvas S1–S4), kept beside the copy from sm up
// so the copy wraps rather than pushing the actions onto their own line.
export function ShiftsHeader({
  backHref,
  backLabel,
  title,
  description,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}

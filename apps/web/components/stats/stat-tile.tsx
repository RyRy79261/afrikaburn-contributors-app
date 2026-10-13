import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@quagga/ui/lib/utils";

// The small figure tile the camp statistics surfaces share (frames C1, C2,
// C3): a label, the number, and a one-line hint. A tile with `href` is the
// way to the list behind the figure — only ever passed for a page the viewer
// may already open (the page decides; the target re-checks).

export function StatTile({
  label,
  value,
  hint,
  href,
  testId,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  testId?: string;
  className?: string;
}) {
  const body = (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {hint && (
        <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {hint}
        </dd>
      )}
    </>
  );
  const box =
    "rounded-lg border border-border bg-secondary/30 p-3 text-card-foreground";
  if (href) {
    return (
      <div className={cn(box, "relative", className)} data-testid={testId}>
        <dl>{body}</dl>
        <Link
          href={href}
          aria-label={`${label}: ${value} — open the list`}
          className="absolute inset-0 rounded-lg hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    );
  }
  return (
    <dl className={cn(box, className)} data-testid={testId}>
      {body}
    </dl>
  );
}

/** "Open the roster →" — the way from a section to the page behind it. */
export function SectionLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4 text-accent" aria-hidden />
    </Link>
  );
}

import Link from "next/link";
import type * as React from "react";
import { FileText, ImageIcon } from "lucide-react";
import { cn } from "@quagga/ui/lib/utils";
import type { ReceiptSubjectKind } from "@quagga/types";
import { receiptHref } from "@/lib/money-view";

// The money page's building blocks (frames M1–M4): a titled section card, a
// figure tile and the receipt tile. Presentational and server-safe.

export function MoneySection({
  icon,
  title,
  badge,
  description,
  action,
  children,
  className,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold normal-case tracking-normal">
            <span className="text-primary [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
              {icon}
            </span>
            {title}
            {badge}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

export function Figure({
  label,
  value,
  sub,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "default" | "warning" | "success";
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-background/40 p-3"
      data-testid={testId}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums sm:text-xl",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function FigureGrid({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        columns === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** The square receipt tile on M3/M4 with "Open" under it. Links to the
 * authorised route only; a stranger following the link gets a 404. */
export function ReceiptTile({
  kind,
  id,
  label,
}: {
  kind: ReceiptSubjectKind;
  id: string;
  label: string;
}) {
  const Icon = label === "PDF" ? FileText : ImageIcon;
  return (
    <Link
      href={receiptHref(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open the receipt (${label})`}
    >
      <span className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-background/40 text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-[10px] font-semibold tracking-wide">{label}</span>
      </span>
      <span className="text-primary">Open</span>
    </Link>
  );
}

/** The plain line at the foot of each tab ("Only the camp's money people…"). */
export function MoneyFootnote({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <span className="mt-0.5 shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </p>
  );
}

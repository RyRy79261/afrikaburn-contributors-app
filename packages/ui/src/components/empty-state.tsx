import * as React from "react";
import { cn } from "../lib/utils";

// A calm, centered empty/parked state — used where a surface has nothing to show
// yet, or is deliberately parked until a later phase (e.g. the org Payments page
// once registration was made free). Warm and honest, never an error.

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional decorative leading icon. */
  icon?: React.ReactNode;
  title: string;
  /** Optional supporting sentence(s). */
  description?: string;
  /** Optional call-to-action (button/link). */
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="text-muted-foreground" aria-hidden>
          {icon}
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
      {children}
    </div>
  );
}

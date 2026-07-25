import * as React from "react";
import { cn } from "../lib/utils";

// Checkbox — a themed native <input type="checkbox"> (canvas Check `OirYR`).
// Native rather than @radix-ui/react-checkbox: the plain control is fully
// accessible, needs no client hooks (so it stays server-component-safe), and
// avoids adding a dependency. `accent-primary` tints it to the Tankwa Night
// primary token in supported browsers.

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      type="checkbox"
      ref={ref}
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";

// AckRow — the acknowledgement-row checkbox variant (registration & supplier
// sign-up acknowledgements). A whole-row <label> (≥44px touch target) wrapping
// the checkbox and its wrapping text, with an optional leading icon. Clicking
// anywhere on the row toggles the box.
export interface AckRowProps extends CheckboxProps {
  /** The acknowledgement text (wraps freely). */
  children: React.ReactNode;
  /** Optional leading icon (e.g. a document glyph). */
  icon?: React.ReactNode;
  /** Class for the outer <label> row. */
  rowClassName?: string;
}

const AckRow = React.forwardRef<HTMLInputElement, AckRowProps>(
  ({ children, icon, className, rowClassName, ...props }, ref) => (
    <label
      className={cn(
        "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border border-input bg-background p-3 text-sm hover:bg-muted/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        rowClassName,
      )}
    >
      <Checkbox ref={ref} className={cn("mt-0.5", className)} {...props} />
      {icon ? (
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="leading-snug">{children}</span>
    </label>
  ),
);
AckRow.displayName = "AckRow";

export { Checkbox, AckRow };

import * as React from "react";
import { cn } from "../lib/utils";

// Field — the label · control · help · error wrapper (canvas Field `UIcOu`
// anatomy). Presentational and stateless, so it stays server-component-safe and
// composes any control in its slot (Input, Select, Textarea, PhoneInput…).
//
// Wiring contract (this component owns no hooks, so ids are explicit): pass the
// SAME `htmlFor` to Field and as the `id` of the control in `children`. Field
// derives `${htmlFor}-help` / `${htmlFor}-error` ids for its help/error text;
// point the control's `aria-describedby` at those (only the visible one applies
// — error supersedes help). The `privacyToggle` slot renders on the label row,
// typically a <Switch variant="privacy" />.

export interface FieldProps {
  /** Field label text. */
  label: React.ReactNode;
  /** id of the control in `children`; also links the <label>. */
  htmlFor?: string;
  /** Marks the field required (renders a "*" and sets the visual hint). */
  required?: boolean;
  /** Muted helper text shown below the control when there is no error. */
  help?: React.ReactNode;
  /** Error text; when present it replaces help and colours the message. */
  error?: React.ReactNode;
  /** Right-aligned label-row slot — e.g. a privacy <Switch variant="privacy" />. */
  privacyToggle?: React.ReactNode;
  /** The control itself. */
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  privacyToggle,
  children,
  className,
}: FieldProps) {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium leading-none text-foreground"
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {privacyToggle ? (
          <div className="shrink-0">{privacyToggle}</div>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

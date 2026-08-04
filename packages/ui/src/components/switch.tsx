"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "../lib/utils";

// Switch — accessible toggle built on a native <button role="switch"> (no
// @radix-ui/react-switch dependency; the interaction is trivial and adding a
// dep is disallowed here). Two shapes:
//
//  • variant="default"  — a bare track+thumb.
//  • variant="privacy"  — the Bio per-field privacy control (canvas `K86ztM`):
//    a caps status label (ON · PUBLIC / OFF · PRIVATE) beside the track.
//
// The Bio hard-lock law (build-spec §Schema, @quagga/core `isHardLockedPrivate`):
// pass `hardLocked` for fields that can NEVER be public (phone, emergency
// contacts, id/passport, medical). It force-renders OFF, disables the control,
// and shows an "ALWAYS PRIVATE" caps label with a lock glyph — never toggleable.
// UI is not the security boundary; this only mirrors the server-enforced law.

const PRIVACY_CAPS =
  "text-[10px] font-semibold uppercase tracking-wide leading-none text-muted-foreground select-none";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "value"
> {
  variant?: "default" | "privacy";
  /** Controlled on/off state. */
  checked?: boolean;
  /** Fired with the next state on toggle. */
  onCheckedChange?: (checked: boolean) => void;
  /** Bio hard-lock: forces OFF, disables, shows "ALWAYS PRIVATE". */
  hardLocked?: boolean;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      variant = "default",
      checked = false,
      onCheckedChange,
      hardLocked = false,
      disabled,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const isOn = hardLocked ? false : checked;
    const isDisabled = disabled || hardLocked;

    const track = (
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={ariaLabel}
        disabled={isDisabled}
        data-state={isOn ? "checked" : "unchecked"}
        onClick={() => {
          if (isDisabled) return;
          onCheckedChange?.(!isOn);
        }}
        ref={ref}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          isOn ? "bg-primary" : "bg-input",
          variant === "default" && className,
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
            isOn ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    );

    if (variant !== "privacy") return track;

    const caps = hardLocked
      ? "Always private"
      : isOn
        ? "On · Public"
        : "Off · Private";

    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <span className={PRIVACY_CAPS}>
          {hardLocked ? (
            <Lock
              className="mr-1 inline-block h-3 w-3 align-[-1px]"
              aria-hidden
            />
          ) : null}
          {caps}
        </span>
        {track}
      </span>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };

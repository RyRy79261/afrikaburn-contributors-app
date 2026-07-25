import * as React from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "../lib/utils";
import {
  deriveWizardProgress,
  type WizardSectionInput,
  type WizardSectionState,
} from "../lib/wizard";

// Wizard — the registration section navigator (canvas `QWDKT`). This is the ONLY
// numbered-sections component in the product (flow red-line); nothing else may
// number its steps. States: done / current / todo / blocked, with a "n of 6
// complete" progress line. Two variants share one derivation: `rail` (desktop
// vertical list) and `strip` (mobile compact row).
//
// Server-component-safe: no hooks. Interactivity is opt-in — pass `onSelect`
// (from a client parent) and each step becomes a button; omit it and the steps
// render as static markers with no event handler (mirrors NotificationBell).

const NUMBER_STYLES: Record<WizardSectionState, string> = {
  done: "border-transparent bg-primary text-primary-foreground",
  current: "border-primary bg-primary/10 text-primary",
  todo: "border-input bg-background text-muted-foreground",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
};

const LABEL_STYLES: Record<WizardSectionState, string> = {
  done: "text-foreground",
  current: "font-medium text-foreground",
  todo: "text-muted-foreground",
  blocked: "text-destructive",
};

function StepMarker({
  index,
  state,
  size = "default",
}: {
  index: number;
  state: WizardSectionState;
  size?: "default" | "sm";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums",
        size === "sm" ? "h-6 w-6" : "h-7 w-7",
        NUMBER_STYLES[state],
      )}
    >
      {state === "done" ? (
        <Check className="h-3.5 w-3.5" />
      ) : state === "blocked" ? (
        <Lock className="h-3 w-3" />
      ) : (
        index
      )}
    </span>
  );
}

export interface WizardProps {
  sections: WizardSectionInput[];
  /** The active section id; falls back to the first actionable step. */
  currentId?: string;
  variant?: "rail" | "strip";
  /** Opt-in navigation. Present → steps are buttons; absent → static markers. */
  onSelect?: (id: string) => void;
  className?: string;
}

export function Wizard({
  sections,
  currentId,
  variant = "rail",
  onSelect,
  className,
}: WizardProps) {
  const { sections: derived, label } = deriveWizardProgress(
    sections,
    currentId,
  );

  if (variant === "strip") {
    return (
      <nav
        aria-label="Registration progress"
        className={cn("flex flex-col gap-2", className)}
      >
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <ol className="flex items-center gap-2">
          {derived.map((s) => (
            <li key={s.id}>
              {onSelect && s.state !== "blocked" ? (
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={s.state === "current" ? "step" : undefined}
                  aria-label={`${s.index}. ${s.label}`}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <StepMarker index={s.index} state={s.state} size="sm" />
                </button>
              ) : (
                <StepMarker index={s.index} state={s.state} size="sm" />
              )}
            </li>
          ))}
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="Registration progress" className={cn("space-y-3", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ol className="space-y-1">
        {derived.map((s) => {
          const inner = (
            <>
              <StepMarker index={s.index} state={s.state} />
              <span className={cn("text-sm leading-snug", LABEL_STYLES[s.state])}>
                {s.label}
              </span>
            </>
          );
          const rowClass = cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left",
            s.state === "current" && "bg-primary/5",
          );
          return (
            <li key={s.id}>
              {onSelect && s.state !== "blocked" ? (
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={s.state === "current" ? "step" : undefined}
                  className={cn(
                    rowClass,
                    "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  {inner}
                </button>
              ) : (
                <div
                  className={rowClass}
                  aria-current={s.state === "current" ? "step" : undefined}
                >
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

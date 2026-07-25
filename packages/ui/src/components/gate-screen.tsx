import * as React from "react";
import { QuiltBand } from "./quilt-band";
import { cn } from "../lib/utils";

// GateScreen — the shared full-viewport blocking layout behind every hard gate:
// the participant blocking-questionnaire fill page and the org / supplier access
// walls (component-spec Tier 2). A pure layout shell of slots — logo, eyebrow,
// card content, sign-out — so each app supplies its own honest copy and actions
// while the chrome (quilt band, centred column, spacing) stays identical.
//
// Presentational (no hooks) → server-component-safe. Blocking gates render ONLY
// this plus sign-out per the flow red-lines; the app decides what goes in the
// card slot.

export interface GateScreenProps {
  /** Brand slot above the eyebrow (e.g. a logo mark). */
  logo?: React.ReactNode;
  /** Caps eyebrow line, e.g. "AfrikaBurn Organiser Console". */
  eyebrow?: React.ReactNode;
  /** The card / main content slot. */
  children: React.ReactNode;
  /** Sign-out slot, pinned below the card (blocking gates: fill + sign-out only). */
  signOut?: React.ReactNode;
  className?: string;
}

export function GateScreen({
  logo,
  eyebrow,
  children,
  signOut,
  className,
}: GateScreenProps) {
  return (
    <div className={cn("flex min-h-svh flex-col bg-background", className)}>
      <QuiltBand />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
        {logo ? <div className="flex justify-center">{logo}</div> : null}
        {eyebrow ? (
          <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        {children}
        {signOut ? (
          <div className="flex justify-center pt-2">{signOut}</div>
        ) : null}
      </main>
    </div>
  );
}

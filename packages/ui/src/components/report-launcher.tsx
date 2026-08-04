"use client";

// THE CORNER INDICATOR (canvas `ReportLauncher` + `ReportLauncherMenu`).
//
// Bottom-LEFT, on every screen, in all three apps. Left because the
// bottom-right is where a page puts its own primary action, and a permanently
// floating control that sits on top of "Submit registration" is a defect
// dressed as a feature. It is small and quiet on purpose: it has to be findable
// at the moment something breaks, and invisible the rest of the time.
//
// Mounted from each app's signed-in shell, never from the root layout — filing
// needs a session, and offering the control to somebody who would be refused is
// worse than not offering it.
//
// On a phone the label drops and it becomes a circle: same control, same
// position, no chrome cost on a 360px screen.

import * as React from "react";
import {
  Bug,
  ExternalLink,
  Lightbulb,
  MessageSquareWarning,
} from "lucide-react";

import type { ReportType } from "@quagga/core";

import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ReportDialog } from "./report-dialog";

const CHOICES: ReadonlyArray<{
  type: ReportType;
  title: string;
  description: string;
  Icon: typeof Bug;
  tint: string;
}> = [
  {
    type: "bug",
    title: "Report a bug",
    description: "Something is broken",
    Icon: Bug,
    tint: "text-primary",
  },
  {
    type: "feature",
    title: "Request a feature",
    description: "Something is missing",
    Icon: Lightbulb,
    tint: "text-accent",
  },
];

export interface ReportLauncherProps {
  className?: string;
  /**
   * False when the deployment has no `GROQ_API_KEY`. Threaded to the dialog so
   * the microphone is hidden rather than offered and then refused.
   */
  dictationEnabled?: boolean;
}

export function ReportLauncher({
  className,
  dictationEnabled = true,
}: ReportLauncherProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [type, setType] = React.useState<ReportType>("bug");

  function choose(next: ReportType) {
    setType(next);
    setMenuOpen(false);
    setDialogOpen(true);
  }

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label="Report a bug or request a feature"
          className={cn(
            // z-40, under the dialog's z-50: once the reporter is open the
            // pill must not sit on top of its own scrim.
            "fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-border bg-card shadow-lg transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "max-sm:p-3 sm:px-4 sm:py-2.5",
            "print:hidden",
            className,
          )}
        >
          <MessageSquareWarning
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden
          />
          <span className="text-xs font-bold tracking-wide text-foreground max-sm:sr-only">
            Report
          </span>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          className="w-auto max-w-[calc(100vw-2.5rem)] p-2 sm:w-66"
        >
          <div className="flex flex-col gap-0.5">
            {CHOICES.map(({ type: choice, title, description, Icon, tint }) => (
              <button
                key={choice}
                type="button"
                onClick={() => choose(choice)}
                className="flex items-center gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className={cn("h-4 w-4 shrink-0", tint)} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {title}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {/* Said before the dialog opens, not only inside it: where this goes
              is the first thing worth knowing about pressing the button. */}
          <p className="mt-1 flex gap-2 border-t border-border px-2.5 pt-2.5 text-[11px] leading-snug text-muted-foreground">
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              Opens a public issue. Your name and email are never attached.
            </span>
          </p>
        </PopoverContent>
      </Popover>

      <ReportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialType={type}
        dictationEnabled={dictationEnabled}
      />
    </>
  );
}

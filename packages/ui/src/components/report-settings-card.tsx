"use client";

// "Bugs and feature requests" — the reporter's entry in Account settings
// (canvas frames SjInE / U6ixd, at the BOTTOM of the page).
//
// It exists for the question you cannot ask the corner pill: *what does this
// send?* Answering it only inside the dialog means the only way to read the
// disclosure is to start a report, which is backwards — so the same panel is
// here, collapsed, reachable without filing anything.

import * as React from "react";
import { Bug, Info, Lightbulb, PlugZap } from "lucide-react";

import type { ReportType } from "@quagga/core";

import { cn } from "../lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { ReportDialog } from "./report-dialog";
import { ReportDiagnosticsPanel } from "./report-diagnostics";

export interface ReportSettingsCardProps {
  /**
   * False when the deployment has no `GITHUB_TOKEN`. The two buttons are
   * replaced by a plain statement: there is nowhere for a report to go, and
   * the honest place to say so is the page somebody opens to ask why there is
   * no Report button in the corner.
   */
  filingEnabled?: boolean;
  /** False when the deployment has no `GROQ_API_KEY`. */
  dictationEnabled?: boolean;
}

export function ReportSettingsCard({
  filingEnabled = true,
  dictationEnabled = true,
}: ReportSettingsCardProps = {}) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<ReportType>("bug");

  function start(next: ReportType) {
    setType(next);
    setOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bugs and feature requests</CardTitle>
        <CardDescription>
          {filingEnabled
            ? "Report from any screen with the button in the bottom-left corner — or start one here."
            : "How reports work here, and what one would send."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!filingEnabled && (
          <p className="flex gap-2.5 rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
            <PlugZap
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span>
              <span className="font-semibold">
                Reporting isn&rsquo;t switched on for this deployment.
              </span>{" "}
              Nothing can be filed from here yet, which is why there is no
              Report button in the corner. Everything below still describes what
              a report would attach once it is.
            </span>
          </p>
        )}

        <div
          className={cn(
            "flex flex-col gap-3 sm:flex-row",
            !filingEnabled && "hidden",
          )}
        >
          {(
            [
              {
                type: "bug" as const,
                title: "Report a bug",
                description: "Something is broken or behaving oddly.",
                Icon: Bug,
                tint: "text-primary",
              },
              {
                type: "feature" as const,
                title: "Request a feature",
                description: "Something is missing or could work better.",
                Icon: Lightbulb,
                tint: "text-accent",
              },
            ] as const
          ).map(({ type: choice, title, description, Icon, tint }) => (
            <button
              key={choice}
              type="button"
              onClick={() => start(choice)}
              className="flex flex-1 items-center gap-3 rounded-lg border border-input p-3.5 text-left transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className={`h-4 w-4 shrink-0 ${tint}`} aria-hidden />
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

        <ReportDiagnosticsPanel title="What a bug report attaches" />

        <p className="flex gap-2.5 rounded-md bg-primary/10 p-3 text-xs leading-relaxed text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            Reports are filed as public issues on GitHub by the AfrikaBurn
            maintainer account, on your behalf, and they arrive untriaged. Your
            name, email and account ID are never in them. The server writes an
            audit line pairing the issue number with your account, so a
            maintainer reading that log could work out who to ask — but nothing
            notifies you, and nobody is watching the issue on your behalf.
          </span>
        </p>
      </CardContent>

      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        initialType={type}
        dictationEnabled={dictationEnabled}
      />
    </Card>
  );
}

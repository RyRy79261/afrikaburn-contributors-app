"use client";

// WHAT A BUG REPORT ATTACHES — shown before it is attached, not after.
//
// One component, rendered in the reporter dialog and again in Account settings
// (canvas: `DiagnosticsDisclosure`, frames mvTaI / uAyrU / SjInE). Two copies
// would drift, and this is the text somebody consents to.
//
// It renders the REAL payload — `buildDiagnostics()` is called here, on the
// same page, and the rows below are the fields that would actually be sent.
// A generic "we collect some diagnostics" is not informed consent when the
// payload might contain the error that leaked somebody's phone number.
//
// Nothing here transmits. Building the object is local and cheap; the reporter
// builds its own when it submits.

import * as React from "react";
import { ChevronDown, Eye, TriangleAlert } from "lucide-react";

import { REPORT_LOGS_MAX, type ReportDiagnostics } from "@quagga/core";

import { buildDiagnostics } from "../lib/report-client";
import { cn } from "../lib/utils";

export interface ReportDiagnosticsPanelProps {
  /** Expanded on first render. The dialog opens it; settings starts closed. */
  defaultOpen?: boolean;
  /**
   * Override the panel heading. Settings says "What a bug report attaches",
   * because there nothing is being filed yet.
   */
  title?: string;
  className?: string;
}

/**
 * Snapshot the diagnostics once per mount.
 *
 * Deliberately not recomputed as the person types: the viewport and path are
 * read at mount, and a panel whose contents shift underneath the reader is
 * worse than one that is a few pixels stale.
 */
function useDiagnosticsSnapshot(): ReportDiagnostics | null {
  const [snapshot, setSnapshot] = React.useState<ReportDiagnostics | null>(
    null,
  );
  // In an effect, not in render: `collectEnvironment()` reads `window` and
  // `navigator`, and this component is rendered inside a server-rendered tree.
  React.useEffect(() => setSnapshot(buildDiagnostics()), []);
  return snapshot;
}

export function ReportDiagnosticsPanel({
  defaultOpen = false,
  title = "What this attaches",
  className,
}: ReportDiagnosticsPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const diagnostics = useDiagnosticsSnapshot();
  const fields = diagnostics?.environment ?? [];
  const errorCount = diagnostics?.errorLogs.length ?? 0;
  const bodyId = React.useId();

  return (
    <div className={cn("rounded-lg border border-input bg-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm font-bold text-foreground">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold tracking-wider text-foreground tabular-nums">
            {fields.length} {fields.length === 1 ? "FIELD" : "FIELDS"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </span>
      </button>

      <div id={bodyId} hidden={!open} className="space-y-3 px-4 pb-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          This report becomes a public issue on GitHub. Your name, email and
          account ID are never attached — only what you write, and these facts
          about the device you&rsquo;re on.
        </p>

        <dl className="space-y-2 rounded-md bg-background px-3 py-3">
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Reading them from this browser&hellip;
            </p>
          ) : (
            fields.map((field) => (
              <div key={field.label} className="flex gap-3">
                <dt className="w-24 shrink-0 text-[10px] font-bold uppercase leading-relaxed tracking-wide text-muted-foreground">
                  {field.label}
                </dt>
                {/* `break-all`: a user-agent string has no spaces to wrap on
                    and would otherwise push the panel wider than the sheet. */}
                <dd className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                  {field.value}
                </dd>
              </div>
            ))
          )}
        </dl>

        {errorCount > 0 && (
          <p className="flex gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-foreground">
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
              aria-hidden
            />
            <span>
              {errorCount} recent {errorCount === 1 ? "error" : "errors"} from
              this tab {errorCount === 1 ? "is" : "are"} attached — the last{" "}
              {REPORT_LOGS_MAX} are kept, and they can quote whatever was on
              screen when they happened.
            </span>
          </p>
        )}

        {/* The two caveats that matter, and the one promise NOT made. */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Paths only — never the query string, so invite tokens and search terms
          stay out. Emails, phone and ID numbers in what you write are stripped
          before posting. That&rsquo;s pattern matching, not a guarantee:
          don&rsquo;t paste somebody else&rsquo;s details.
        </p>
      </div>
    </div>
  );
}

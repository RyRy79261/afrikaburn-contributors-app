"use client";

// THE REPORTER. A dialog on a desktop, a sheet on a phone, one component
// (canvas frames mvTaI, uAyrU, n2mcuK).
//
// What it is responsible for is the SAYING: what type of report this is, what
// leaves the device with it, and where the words end up. The deciding lives
// elsewhere on purpose — `lib/report-client.ts` builds the payload,
// `@quagga/core/report-server` decides what is published — so this file can be
// read as "what is a person told, and when".
//
// Three of those are load-bearing:
//
// 1. **Choosing Feature removes the diagnostics entirely**, and says so. Not a
//    toggle that happens to default off: a feature request has no environment
//    attached, so the panel is replaced by the sentence that says nothing about
//    the device is going.
// 2. **The disclosure sits above the Send button, expanded, on a bug.** It is
//    not behind a "details" link somebody clicks after deciding.
// 3. **Dictation is never the only way in.** `unsupported` hides the control and
//    changes nothing else; the textarea is the path, and the microphone is a
//    shortcut to it.

import * as React from "react";
import {
  Bug,
  Check,
  Lightbulb,
  Link as LinkIcon,
  Loader2,
  Mic,
  MicOff,
  ShieldCheck,
  Square,
} from "lucide-react";

import { REPORT_DESCRIPTION_MAX, type ReportType } from "@quagga/core";

import { ReportError, submitReport } from "../lib/report-client";
import { useDictation } from "../lib/use-dictation";
import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { ReportDiagnosticsPanel } from "./report-diagnostics";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

export interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which choice opened it. The person can still switch inside. */
  initialType?: ReportType;
}

interface TypeChoice {
  type: ReportType;
  title: string;
  description: string;
  Icon: typeof Bug;
}

const TYPES: readonly TypeChoice[] = [
  {
    type: "bug",
    title: "Report a bug",
    description: "Something is broken or behaving oddly.",
    Icon: Bug,
  },
  {
    type: "feature",
    title: "Request a feature",
    description: "Something is missing or could work better.",
    Icon: Lightbulb,
  },
];

function TypeOption({
  choice,
  selected,
  onSelect,
}: {
  choice: TypeChoice;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon } = choice;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex-1 rounded-lg border p-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/10"
          : "border-input bg-card hover:border-muted-foreground/40",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              selected ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="text-sm font-bold text-foreground">
            {choice.title}
          </span>
        </span>
        <span
          className={cn(
            "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-primary bg-primary" : "border-input",
          )}
        >
          {selected && (
            <Check
              className="h-3 w-3 text-primary-foreground"
              strokeWidth={3}
              aria-hidden
            />
          )}
        </span>
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
        {choice.description}
      </span>
    </button>
  );
}

/** A labelled switch row. Same shape for both of the dialog's toggles. */
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

export function ReportDialog({
  open,
  onOpenChange,
  initialType = "bug",
}: ReportDialogProps) {
  const [type, setType] = React.useState<ReportType>(initialType);
  const [description, setDescription] = React.useState("");
  const [dictated, setDictated] = React.useState(false);
  const [attachDiagnostics, setAttachDiagnostics] = React.useState(true);
  const [useAi, setUseAi] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filed, setFiled] = React.useState<{
    url: string;
    number: number;
  } | null>(null);

  // Reopening starts clean — except the type, which follows the menu choice
  // that opened it.
  React.useEffect(() => {
    if (!open) return;
    setType(initialType);
    setDescription("");
    setDictated(false);
    setAttachDiagnostics(true);
    setUseAi(true);
    setError(null);
    setFiled(null);
  }, [open, initialType]);

  const dictation = useDictation({
    onTranscript: (text) => {
      setDictated(true);
      // Appended, never replacing: somebody who typed two sentences and then
      // spoke a third must not lose the two.
      setDescription((current) =>
        current ? `${current.trimEnd()} ${text}` : text,
      );
    },
  });

  const recording =
    dictation.state === "recording" || dictation.state === "requesting";
  const transcribing = dictation.state === "transcribing";
  const busy = submitting || recording || transcribing;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim() || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitReport({
        type,
        description,
        dictated,
        useAi,
        // A feature request attaches nothing about the device, whatever the
        // toggle last said while Bug was selected.
        includeDiagnostics: type === "bug" && attachDiagnostics,
      });
      setFiled(result);
    } catch (cause) {
      setError(
        cause instanceof ReportError
          ? cause.message
          : "That didn't go through. Your words are still here — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isBug = type === "bug";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!submitting}
        // Sheet on a phone, centred dialog from `sm` up. The overrides are
        // media-query variants so they win inside their breakpoint.
        className="max-h-[92dvh] gap-0 overflow-y-auto p-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl sm:max-w-[600px]"
      >
        {filed ? (
          <div className="space-y-4 p-6">
            <DialogTitle className="text-lg font-extrabold">
              Filed as issue #{filed.number}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              It&rsquo;s in the queue tagged <code>needs-triage</code>. Nobody
              has looked at it yet, and it isn&rsquo;t assigned to anyone.
            </DialogDescription>
            <a
              href={filed.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <LinkIcon className="h-4 w-4" aria-hidden />
              View it on GitHub
            </a>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="space-y-1 p-5 pr-12">
              <DialogTitle className="text-lg font-extrabold">
                {isBug ? "Report a bug" : "Request a feature"}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Filed as a public issue on GitHub by the AfrikaBurn maintainer
                account, on your behalf. It arrives untriaged, and it is not
                anonymous to us — we keep a note of who sent it.
              </DialogDescription>
            </div>

            <div className="space-y-4 border-t border-border p-5">
              <div
                role="radiogroup"
                aria-label="What kind of report is this?"
                className="flex flex-col gap-2 sm:flex-row sm:gap-3"
              >
                {TYPES.map((choice) => (
                  <TypeOption
                    key={choice.type}
                    choice={choice}
                    selected={type === choice.type}
                    onSelect={() => setType(choice.type)}
                  />
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="report-description"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    {isBug ? "What happened?" : "What would help?"}
                  </label>
                  {dictation.supported && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        "rounded-full",
                        recording &&
                          "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/15",
                      )}
                      disabled={submitting || transcribing}
                      onClick={() =>
                        recording ? dictation.stop() : void dictation.start()
                      }
                    >
                      {transcribing ? (
                        <>
                          <Loader2 className="animate-spin" aria-hidden />
                          Transcribing&hellip;
                        </>
                      ) : recording ? (
                        <>
                          <Square aria-hidden />
                          Stop
                        </>
                      ) : (
                        <>
                          <Mic aria-hidden />
                          Dictate
                        </>
                      )}
                    </Button>
                  )}
                </div>

                <Textarea
                  id="report-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={REPORT_DESCRIPTION_MAX}
                  rows={6}
                  disabled={submitting}
                  placeholder={
                    isBug
                      ? "What were you doing, and what did the app do instead?"
                      : "What are you trying to do, and what would make it easier?"
                  }
                />
                <p className="text-right text-[11px] tabular-nums text-muted-foreground">
                  {description.length.toLocaleString()} /{" "}
                  {REPORT_DESCRIPTION_MAX.toLocaleString()} characters
                </p>

                {/* Said before the microphone is used, not after. */}
                {dictation.supported ? (
                  <p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                    {recording ? (
                      <Mic
                        className="mt-0.5 h-3 w-3 shrink-0 text-destructive"
                        aria-hidden
                      />
                    ) : (
                      <Mic className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <span>
                      Dictation sends the recording to our transcription
                      provider to turn into text. It isn&rsquo;t stored, and you
                      can edit the words before sending.
                    </span>
                  </p>
                ) : (
                  <p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                    <MicOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      Dictation isn&rsquo;t available in this browser. Typing
                      does exactly the same job.
                    </span>
                  </p>
                )}

                {dictation.error && (
                  <p className="text-[11px] text-destructive">
                    {dictation.error}
                  </p>
                )}
              </div>

              {isBug ? (
                <>
                  <ReportDiagnosticsPanel defaultOpen />
                  <ToggleRow
                    label="Attach the diagnostics above"
                    description="Turn this off and we get only your words — which usually means a slower fix."
                    checked={attachDiagnostics}
                    onCheckedChange={setAttachDiagnostics}
                  />
                </>
              ) : (
                <div className="flex gap-2.5 rounded-lg bg-success/10 p-3">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden
                  />
                  <div>
                    <p className="text-[13px] font-bold text-foreground">
                      Nothing about your device is attached
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      A feature request carries only what you write. Choose
                      Report a bug and this becomes a full list of what would be
                      attached, shown before you send.
                    </p>
                  </div>
                </div>
              )}

              <ToggleRow
                label={
                  isBug
                    ? "Let Claude tidy this into steps"
                    : "Let Claude tidy this into a summary"
                }
                description="Your own words are kept in the issue either way."
                checked={useAi}
                onCheckedChange={setUseAi}
              />

              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border p-4 max-sm:flex-col-reverse max-sm:items-stretch">
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground max-sm:justify-center">
                <LinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                You&rsquo;ll get the issue link once it&rsquo;s filed.
              </p>
              <div className="flex items-center gap-2.5 max-sm:flex-row-reverse">
                <Button
                  type="submit"
                  disabled={!description.trim() || busy}
                  className="max-sm:flex-1"
                >
                  {submitting && (
                    <Loader2 className="animate-spin" aria-hidden />
                  )}
                  {isBug ? "Send report" : "Send request"}
                </Button>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" disabled={submitting}>
                    Cancel
                  </Button>
                </DialogClose>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { nextPageId, pageById } from "@quagga/core";
import {
  pageBlocks,
  type Questionnaire,
  type QuestionnaireResponses,
  type QuestionnaireResponseValue,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";

import { QuestionField } from "@/components/questionnaire/field";
import { ContentBlockView } from "@/components/questionnaire/content-block";

// Author preview (questionnaire-spec §"Builder v2": the "Preview" control next
// to "Send"). Renders the CURRENT draft the way a respondent walks it —
// branch-aware (core `nextPageId`), content blocks inline, every question kind
// answerable — WITHOUT activating anything. Nothing is persisted; the state is
// throwaway and resets each time the dialog opens.
//
// It deliberately reuses the console's own QuestionField renderer so the preview
// tracks what a real fill looks like, and reuses the same @quagga/core branching
// the runner and the submit validator use — so what the author sees here is what
// a recipient actually gets.

export function QuestionnairePreview({
  definition,
  disabled,
}: {
  definition: Questionnaire;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Eye aria-hidden />
        Preview
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Capped, with the walk scrolling INSIDE (see PreviewRunner). With no
            cap a long section ran off the bottom of the viewport and took the
            Back/Next controls with it; Radix locks the page behind a modal and
            the dialog had no overflow of its own, so the author could neither
            read the rest of the section nor advance past it. */}
        <DialogContent className="max-h-[85svh] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              This is exactly what a recipient sees — branching and all. Nothing
              here is saved, and no questionnaire is sent.
            </DialogDescription>
          </DialogHeader>
          {/* Remount on each open so the walk starts fresh. */}
          {open ? <PreviewRunner definition={definition} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewRunner({ definition }: { definition: Questionnaire }) {
  const firstId = definition.pages[0]?.id ?? null;
  const [responses, setResponses] = React.useState<QuestionnaireResponses>({});
  const [history, setHistory] = React.useState<string[]>(
    firstId ? [firstId] : [],
  );
  const [ended, setEnded] = React.useState(false);

  const currentId = history[history.length - 1] ?? null;
  const page = currentId ? pageById(definition, currentId) : null;

  function setResponse(id: string, value: QuestionnaireResponseValue) {
    setResponses((prev) => ({ ...prev, [id]: value }));
  }

  function restart() {
    setResponses({});
    setHistory(firstId ? [firstId] : []);
    setEnded(false);
  }

  if (ended) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <Badge variant="success">End of questionnaire</Badge>
        <p className="max-w-sm text-sm text-muted-foreground">
          This is where a respondent would submit. Nothing was saved — this is
          only a preview.
        </p>
        <Button type="button" variant="outline" onClick={restart}>
          Start over
        </Button>
      </div>
    );
  }

  if (!page || !currentId) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing to preview yet — add a section and a question.
      </p>
    );
  }

  // Branch resolution is delegated to the engine: the "next" the author sees
  // here is the same one the runner walks and the server re-derives on submit.
  const next = nextPageId(definition, currentId, responses);

  function goNext() {
    if (next === null) {
      setEnded(true);
      return;
    }
    setHistory((prev) => [...prev, next]);
  }

  function goBack() {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  const sectionNumber = definition.pages.findIndex((p) => p.id === currentId) + 1;

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Section {sectionNumber}</Badge>
        <span>of {definition.pages.length}</span>
      </div>

      {/* Only the section body scrolls — the Back/Next row below stays put. */}
      <div className="flex min-h-0 max-h-[60svh] flex-1 flex-col overflow-y-auto pr-1">
        {page.kind === "intro" ? (
          <div className="flex flex-col gap-3 py-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              {page.heading}
            </h2>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {page.body}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold">{page.title}</h2>
              {page.subtitle && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {page.subtitle}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-5">
              {pageBlocks(page).map((block) =>
                "prompt" in block ? (
                  <QuestionField
                    key={block.id}
                    question={block}
                    value={responses[block.id]}
                    onChange={(value) => setResponse(block.id, value)}
                  />
                ) : (
                  <ContentBlockView key={block.id} block={block} />
                ),
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={goBack}
          disabled={history.length <= 1}
        >
          Back
        </Button>
        <Button type="button" onClick={goNext}>
          {next === null ? "Finish preview" : "Next"}
        </Button>
      </div>
    </div>
  );
}

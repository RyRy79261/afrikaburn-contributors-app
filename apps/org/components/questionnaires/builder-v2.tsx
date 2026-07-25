"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Layers,
  Plus,
  Send,
  Tent,
  Trash2,
} from "lucide-react";
import {
  validateQuestionnaireDefinition,
  type DefinitionIssue,
} from "@quagga/core";
import {
  OFFICER_AUDIENCE_LABELS,
  OFFICER_KEYS,
  ORG_OUTBOUND_SELECTORS,
  ORG_OUTBOUND_SELECTOR_LABELS,
  SUBMIT_TARGET,
  pageBlocks,
  type AudienceSpec,
  type OfficerKey,
  type OrgOutboundSelector,
  type PageBlock,
  type Questionnaire,
  type QuestionnairePage,
} from "@quagga/types";
import { AudienceSelect } from "@quagga/ui/components/audience-select";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Input } from "@quagga/ui/components/input";
import { Switch } from "@quagga/ui/components/switch";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";

import {
  BlockEditor,
  withCurrentTarget,
  type BranchTarget,
} from "./block-editor";
import {
  PALETTE,
  allocateId,
  blockPaletteKind,
  convertBlock,
  createBlock,
  createSection,
  duplicateBlock,
  takenIds,
  type PaletteKind,
} from "./block-kinds";
import {
  DefinitionIssuePanel,
  IssueNote,
  sectionIssues,
} from "./definition-issues";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { saveDefinitionV2 } from "@/app/(console)/questionnaires/builder-actions";
import { previewAudienceCount } from "@/lib/questionnaires/actions";

// Builder v2 (questionnaire-spec §"Builder v2 — Google Forms parity").
//
// The editor state IS the definition: a `Questionnaire` mutated immutably. That
// buys two things for free — question ids never drift on reorder (we move the
// object, not a projection of it), and @quagga/core's
// `validateQuestionnaireDefinition` can be run against the live draft to place
// its issues inline. Nothing here re-implements validation, branching or
// reachability; the engine owns all three.

const CONTINUE = "__continue__";

export interface BuilderV2Initial {
  key: string;
  title: string;
  description: string;
  definition: Questionnaire;
  status: "draft" | "published" | "unpublished";
}

interface AudienceChoice {
  value: string;
  label: string;
}

const AUDIENCE_OPTIONS: AudienceChoice[] = [
  { value: "internal", label: "Org members (internal)" },
  ...ORG_OUTBOUND_SELECTORS.map((s) => ({
    value: `outbound:${s}`,
    label: ORG_OUTBOUND_SELECTOR_LABELS[s],
  })),
  ...OFFICER_KEYS.map((k) => ({
    value: `officer:${k}`,
    label: OFFICER_AUDIENCE_LABELS[k],
  })),
];

/** The audience rail's single choice → the engine's audience spec. */
function specForChoice(choice: string): AudienceSpec | null {
  if (choice === "internal") return { kind: "org_internal" };
  if (choice.startsWith("outbound:")) {
    return {
      kind: "org_outbound",
      selectors: [choice.slice("outbound:".length) as OrgOutboundSelector],
    };
  }
  if (choice.startsWith("officer:")) {
    return {
      kind: "org_officer",
      officerKeys: [choice.slice("officer:".length) as OfficerKey],
    };
  }
  return null;
}

function sectionLabel(page: QuestionnairePage, index: number): string {
  const title =
    page.kind === "questions" ? page.title : page.heading;
  return `${index + 1}. ${title?.trim() || "Untitled section"}`;
}

function emptyDraft(): Questionnaire {
  return {
    version: "1",
    pages: [{ id: "section_1", kind: "questions", title: "Section 1", questions: [] }],
  };
}

export function QuestionnaireBuilderV2({
  initial,
  editionId,
}: {
  initial?: BuilderV2Initial;
  editionId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? "",
  );
  const [draft, setDraft] = React.useState<Questionnaire>(
    initial?.definition ?? emptyDraft(),
  );
  const [activeSection, setActiveSection] = React.useState(0);
  const [showIssues, setShowIssues] = React.useState(false);

  // Send options rail — carried to the activation screen, never written here.
  const [audienceChoice, setAudienceChoice] = React.useState<string>("");
  const [blocking, setBlocking] = React.useState(false);
  const [dueAt, setDueAt] = React.useState("");
  const [resolvedCount, setResolvedCount] = React.useState<number | null>(null);

  // The definition exactly as it will be stored: the first questions page
  // carries the questionnaire's own title/description (the save action
  // normalises it that way, so the builder shows the truth up front).
  const definition = React.useMemo<Questionnaire>(
    () => ({
      ...draft,
      pages: draft.pages.map((page, index) =>
        index === 0 && page.kind === "questions"
          ? {
              ...page,
              title: title.trim() || page.title,
              subtitle: description.trim() || undefined,
            }
          : page,
      ),
    }),
    [draft, title, description],
  );

  const liveIssues = React.useMemo<DefinitionIssue[]>(() => {
    const result = validateQuestionnaireDefinition(definition);
    return result.ok ? [] : result.issues;
  }, [definition]);
  const issues = showIssues ? liveIssues : [];

  const sectionTitles = definition.pages.map((p) =>
    p.kind === "questions" ? p.title : p.heading,
  );

  const spec = audienceChoice ? specForChoice(audienceChoice) : null;
  const specKey = spec ? JSON.stringify(spec) : "";

  React.useEffect(() => {
    if (!spec || !editionId) {
      setResolvedCount(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewAudienceCount({ audience: spec, editionId });
      if (cancelled) return;
      setResolvedCount(result.ok ? result.count : null);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `specKey` is the serialised `spec`: keying on it (rather than the object,
    // which is rebuilt every render) is what stops this resolving in a loop.
  }, [specKey, editionId]);

  // --- draft mutation ----------------------------------------------------

  function updatePage(index: number, next: QuestionnairePage) {
    setDraft((prev) => ({
      ...prev,
      pages: prev.pages.map((p, i) => (i === index ? next : p)),
    }));
  }

  function updateBlocks(pageIndex: number, blocks: PageBlock[]) {
    setDraft((prev) => ({
      ...prev,
      pages: prev.pages.map((page, i) =>
        i === pageIndex && page.kind === "questions"
          ? { ...page, questions: blocks }
          : page,
      ),
    }));
  }

  function addBlock(kind: PaletteKind) {
    setDraft((prev) => {
      const taken = takenIds(prev);
      const id = allocateId(kind === "info_block" || kind === "image_block" ? "block" : "q", taken);
      const target = Math.min(activeSection, prev.pages.length - 1);
      return {
        ...prev,
        pages: prev.pages.map((page, i) =>
          i === target && page.kind === "questions"
            ? { ...page, questions: [...page.questions, createBlock(kind, id)] }
            : page,
        ),
      };
    });
  }

  function addSection() {
    setDraft((prev) => {
      const taken = takenIds(prev);
      const id = allocateId("section", taken);
      return { ...prev, pages: [...prev.pages, createSection(id, prev.pages.length)] };
    });
    setActiveSection(draft.pages.length);
  }

  function moveSection(index: number, delta: number) {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.pages.length) return prev;
      const pages = [...prev.pages];
      const a = pages[index];
      const b = pages[target];
      if (!a || !b) return prev;
      pages[index] = b;
      pages[target] = a;
      return { ...prev, pages };
    });
  }

  function removeSection(index: number) {
    setDraft((prev) =>
      prev.pages.length <= 1
        ? prev
        : { ...prev, pages: prev.pages.filter((_, i) => i !== index) },
    );
    setActiveSection(0);
  }

  // --- save --------------------------------------------------------------

  function save(publish: boolean) {
    if (!title.trim()) {
      toast.error("Check the questionnaire", {
        description: "Give the questionnaire a title.",
      });
      return;
    }
    // Client-side gate mirrors the server-side one; the server re-runs it.
    const validation = validateQuestionnaireDefinition(definition);
    if (!validation.ok) {
      setShowIssues(true);
      toast.error("Not saved", {
        description:
          validation.issues.length === 1
            ? "1 problem is blocking this save."
            : `${validation.issues.length} problems are blocking this save.`,
      });
      return;
    }

    startTransition(async () => {
      const result = await saveDefinitionV2({
        key: initial?.key,
        title: title.trim(),
        description: description.trim() || undefined,
        definition: validation.definition,
        publish,
      });
      if (!result.ok) {
        setShowIssues(result.issues.length > 0);
        toast.error("Could not save", { description: result.error });
        return;
      }
      setShowIssues(false);
      toast.success(publish ? "Questionnaire published." : "Draft saved.");
      if (publish) {
        const params = new URLSearchParams();
        if (audienceChoice) params.set("audience", audienceChoice);
        if (blocking) params.set("blocking", "1");
        if (dueAt) params.set("due", dueAt);
        const query = params.toString();
        router.push(
          `/questionnaires/${result.key}/activate${query ? `?${query}` : ""}`,
        );
      } else {
        router.push(`/questionnaires/${result.key}/edit`);
      }
      router.refresh();
    });
  }

  const questionCount = definition.pages.reduce(
    (n, page) => n + pageBlocks(page).filter((b) => "prompt" in b).length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Fewer-forms warning — the builder holds ITSELF to the principle. */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
        <Tent className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold text-foreground">
            Every question you add is a question someone in the desert has to
            answer.
          </p>
          <p className="mt-1 text-muted-foreground">
            Ask for the least you need. Mark a question required only if a
            missing answer genuinely blocks the burn.
          </p>
        </div>
      </div>

      <DefinitionIssuePanel issues={issues} sectionTitles={sectionTitles} />

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
        <PaletteRail
          activeLabel={
            definition.pages[Math.min(activeSection, definition.pages.length - 1)]
              ? sectionLabel(
                  definition.pages[
                    Math.min(activeSection, definition.pages.length - 1)
                  ]!,
                  Math.min(activeSection, definition.pages.length - 1),
                )
              : "—"
          }
          onAdd={addBlock}
          onAddSection={addSection}
        />

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  Title <span className="text-destructive">*</span>
                </span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Pre-event safety check-in"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Description</span>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="One line telling recipients why you're asking."
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {definition.pages.length}{" "}
                {definition.pages.length === 1 ? "section" : "sections"} ·{" "}
                {questionCount} {questionCount === 1 ? "question" : "questions"}
              </p>
            </CardContent>
          </Card>

          {definition.pages.map((page, pageIndex) => (
            <SectionEditor
              key={page.id}
              page={page}
              pageIndex={pageIndex}
              totalSections={definition.pages.length}
              active={activeSection === pageIndex}
              issues={issues}
              allPages={definition.pages}
              titleLocked={pageIndex === 0}
              onActivate={() => setActiveSection(pageIndex)}
              onChangePage={(next) => updatePage(pageIndex, next)}
              onChangeBlocks={(blocks) => updateBlocks(pageIndex, blocks)}
              onMoveSection={(delta) => moveSection(pageIndex, delta)}
              onRemoveSection={() => removeSection(pageIndex)}
              onAddBlock={(kind) => {
                setActiveSection(pageIndex);
                addBlock(kind);
              }}
            />
          ))}

          <Button variant="outline" onClick={addSection} className="self-start">
            <Layers aria-hidden />
            Add section
          </Button>
        </div>

        <SendRail
          audienceChoice={audienceChoice}
          onAudienceChange={setAudienceChoice}
          resolvedCount={resolvedCount}
          hasEdition={editionId !== null}
          blocking={blocking}
          onBlockingChange={setBlocking}
          dueAt={dueAt}
          onDueAtChange={setDueAt}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {initial ? (
          <Badge variant={initial.status === "published" ? "success" : "outline"}>
            {initial.status}
          </Badge>
        ) : null}
        <span className="mr-auto text-xs text-muted-foreground">
          {liveIssues.length > 0
            ? `${liveIssues.length} ${liveIssues.length === 1 ? "problem" : "problems"} to fix before this can be saved.`
            : "Ready to save."}
        </span>
        <Button variant="ghost" onClick={() => router.push("/questionnaires")}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => save(false)}
          disabled={pending}
        >
          Save draft
        </Button>
        <Button onClick={() => save(true)} disabled={pending}>
          <Send aria-hidden />
          {pending ? "Saving…" : "Publish & choose audience"}
        </Button>
      </div>
    </div>
  );
}

function PaletteRail({
  activeLabel,
  onAdd,
  onAddSection,
}: {
  activeLabel: string;
  onAdd: (kind: PaletteKind) => void;
  onAddSection: () => void;
}) {
  const content = PALETTE.filter((p) => p.group === "content");
  const questions = PALETTE.filter((p) => p.group === "question");
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <Card>
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add a block
            </span>
            <span className="truncate text-xs text-muted-foreground">
              to {activeLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={onAddSection}
            className="flex items-center gap-2 rounded-md border border-input px-2.5 py-2 text-sm transition-colors hover:bg-muted"
          >
            <Layers className="h-4 w-4 text-accent" aria-hidden />
            Section / page break
          </button>

          <PaletteGroup label="Content" entries={content} onAdd={onAdd} />
          <PaletteGroup label="Question types" entries={questions} onAdd={onAdd} />
        </CardContent>
      </Card>
    </aside>
  );
}

function PaletteGroup({
  label,
  entries,
  onAdd,
}: {
  label: string;
  entries: readonly (typeof PALETTE)[number][];
  onAdd: (kind: PaletteKind) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <button
            key={entry.kind}
            type="button"
            onClick={() => onAdd(entry.kind)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionEditor({
  page,
  pageIndex,
  totalSections,
  active,
  issues,
  allPages,
  titleLocked,
  onActivate,
  onChangePage,
  onChangeBlocks,
  onMoveSection,
  onRemoveSection,
  onAddBlock,
}: {
  page: QuestionnairePage;
  pageIndex: number;
  totalSections: number;
  active: boolean;
  issues: readonly DefinitionIssue[];
  allPages: readonly QuestionnairePage[];
  titleLocked: boolean;
  onActivate: () => void;
  onChangePage: (next: QuestionnairePage) => void;
  onChangeBlocks: (blocks: PageBlock[]) => void;
  onMoveSection: (delta: number) => void;
  onRemoveSection: () => void;
  onAddBlock: (kind: PaletteKind) => void;
}) {
  const mine = sectionIssues(issues, pageIndex);
  // Forward-only: a section may only branch to one that comes AFTER it, or to
  // submit. The validator enforces this; the picker never offers otherwise.
  const branchTargets: BranchTarget[] = [
    ...allPages
      .slice(pageIndex + 1)
      .map((p, i) => ({ value: p.id, label: sectionLabel(p, pageIndex + 1 + i) })),
    { value: SUBMIT_TARGET, label: "Submit the questionnaire" },
  ];

  const blocks = pageBlocks(page);

  function setBlock(index: number, next: PageBlock) {
    onChangeBlocks(blocks.map((b, i) => (i === index ? next : b)));
  }

  return (
    <section
      onFocusCapture={onActivate}
      onClick={onActivate}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 transition-colors",
        active ? "border-accent/60 bg-accent/5" : "border-border",
        mine.length > 0 && "border-destructive/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Section {pageIndex + 1}</Badge>
        <span className="font-mono text-[11px] text-muted-foreground">
          {page.id}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move section up"
            disabled={pageIndex === 0}
            onClick={() => onMoveSection(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Move section down"
            disabled={pageIndex === totalSections - 1}
            onClick={() => onMoveSection(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove section"
            disabled={totalSections <= 1}
            onClick={onRemoveSection}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {page.kind === "questions" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Section title
              </span>
              <Input
                value={page.title}
                disabled={titleLocked}
                onChange={(e) => onChangePage({ ...page, title: e.target.value })}
                placeholder="Section title"
              />
              {titleLocked ? (
                <span className="text-xs text-muted-foreground">
                  The first section carries the questionnaire title and
                  description.
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Section description
              </span>
              <Input
                value={page.subtitle ?? ""}
                disabled={titleLocked}
                onChange={(e) =>
                  onChangePage({
                    ...page,
                    subtitle: e.target.value || undefined,
                  })
                }
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {blocks.map((block, blockIndex) => (
              <BlockEditor
                key={block.id}
                block={block}
                pageIndex={pageIndex}
                blockIndex={blockIndex}
                total={blocks.length}
                issues={issues}
                branchTargets={branchTargets}
                onChange={(next) => setBlock(blockIndex, next)}
                onConvert={(kind) =>
                  setBlock(blockIndex, convertBlock(block, kind))
                }
                onMove={(delta) => {
                  const target = blockIndex + delta;
                  if (target < 0 || target >= blocks.length) return;
                  const next = [...blocks];
                  const a = next[blockIndex];
                  const b = next[target];
                  if (!a || !b) return;
                  // Reorder moves the OBJECT — ids ride along untouched.
                  next[blockIndex] = b;
                  next[target] = a;
                  onChangeBlocks(next);
                }}
                onDuplicate={() => {
                  const taken = new Set(
                    allPages.flatMap((p) => [
                      p.id,
                      ...pageBlocks(p).map((b) => b.id),
                    ]),
                  );
                  const prefix = blockPaletteKind(block) === "info_block" ||
                    blockPaletteKind(block) === "image_block"
                    ? "block"
                    : "q";
                  const next = [...blocks];
                  next.splice(
                    blockIndex + 1,
                    0,
                    duplicateBlock(block, allocateId(prefix, taken)),
                  );
                  onChangeBlocks(next);
                }}
                onRemove={() =>
                  onChangeBlocks(blocks.filter((_, i) => i !== blockIndex))
                }
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value=""
                onValueChange={(v) => onAddBlock(v as PaletteKind)}
              >
                <SelectTrigger
                  className="w-56"
                  aria-label={`Add a block to section ${pageIndex + 1}`}
                >
                  <SelectValue placeholder="Add a block…" />
                </SelectTrigger>
                <SelectContent>
                  {PALETTE.map((entry) => (
                    <SelectItem key={entry.kind} value={entry.kind}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddBlock("short_text")}
              >
                <Plus aria-hidden />
                Quick question
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  Shuffle question order
                </span>
                <span className="text-xs text-muted-foreground">
                  Randomised per respondent, seeded so a reload is stable.
                </span>
              </div>
              <Switch
                checked={page.shuffleQuestions ?? false}
                aria-label="Shuffle question order"
                onCheckedChange={(shuffleQuestions) =>
                  onChangePage({
                    ...page,
                    shuffleQuestions: shuffleQuestions || undefined,
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                After this section, go to
              </span>
              <Select
                value={page.next ?? CONTINUE}
                onValueChange={(v) =>
                  onChangePage({
                    ...page,
                    next: v === CONTINUE ? undefined : v,
                  })
                }
              >
                <SelectTrigger
                  className="max-w-sm"
                  aria-label={`Where section ${pageIndex + 1} goes next`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CONTINUE}>The next section</SelectItem>
                  {withCurrentTarget(branchTargets, page.next).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Per-answer branching lives on each multiple-choice question.
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-3">
          <Input
            value={page.heading}
            onChange={(e) => onChangePage({ ...page, heading: e.target.value })}
            placeholder="Interstitial heading"
            aria-label="Interstitial heading"
          />
          <Textarea
            value={page.body}
            rows={3}
            onChange={(e) => onChangePage({ ...page, body: e.target.value })}
            placeholder="Interstitial body"
            aria-label="Interstitial body"
          />
        </div>
      )}

      <IssueNote issues={mine} />
    </section>
  );
}

function SendRail({
  audienceChoice,
  onAudienceChange,
  resolvedCount,
  hasEdition,
  blocking,
  onBlockingChange,
  dueAt,
  onDueAtChange,
}: {
  audienceChoice: string;
  onAudienceChange: (value: string) => void;
  resolvedCount: number | null;
  hasEdition: boolean;
  blocking: boolean;
  onBlockingChange: (next: boolean) => void;
  dueAt: string;
  onDueAtChange: (next: string) => void;
}) {
  return (
    <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
      <Card>
        <CardHeader>
          <CardTitle>Audience &amp; send</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Who is this for
            </span>
            <AudienceSelect
              options={AUDIENCE_OPTIONS}
              value={audienceChoice || undefined}
              onValueChange={onAudienceChange}
              resolvedCount={hasEdition ? resolvedCount : null}
              countNoun="people"
              placeholder="Choose an audience"
            />
            <span className="text-xs text-muted-foreground">
              Org-internal questionnaires stay in this console — they never
              reach the participant app.
            </span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Blocking</span>
              <span className="text-xs text-muted-foreground">
                A hard gate: recipients can do nothing else until they submit.
              </span>
            </div>
            <Switch
              checked={blocking}
              onCheckedChange={onBlockingChange}
              aria-label="Blocking"
            />
          </div>
          <div>
            <BlockingBadge blocking={blocking} />
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Due date (optional)
            </span>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => onDueAtChange(e.target.value)}
            />
          </label>

          <p className="text-xs text-muted-foreground">
            These carry through to the send screen, where the audience is
            resolved and the questionnaire actually goes out.
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}

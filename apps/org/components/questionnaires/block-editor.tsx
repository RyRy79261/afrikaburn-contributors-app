"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerDownRight,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { DefinitionIssue } from "@quagga/core";
import {
  SUBMIT_TARGET,
  isAnswerableBlock,
  type ImageBlock,
  type PageBlock,
  type Question,
  type QuestionOption,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { FileUpload } from "@quagga/ui/components/file-upload";
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
import { cn } from "@quagga/ui/lib/utils";

import {
  PALETTE,
  PALETTE_BY_KIND,
  blockPaletteKind,
  type PaletteKind,
} from "./block-kinds";
import { IssueNote, blockIssues, optionIssues } from "./definition-issues";

// One block's editor: the type selector, the prompt, the per-type controls,
// the validation-rule controls, and (single choice only) the branching editor.
//
// Two invariants this file protects:
//   1. Block ids are NEVER recomputed here — not on reorder, not on retype,
//      not on relabel. A question id is the key its answers are stored under.
//   2. Option VALUES are allocated once and shown read-only. Editing a label is
//      a display change; editing a value would silently orphan collected data.

/** "Continue to the next section" — Radix Select forbids an empty item value. */
const CONTINUE = "__continue__";

// Whether this deployment has Blob storage, provided once at the builder root so
// the deeply-nested image controls (image blocks + image-choice options) don't
// each need it threaded through SectionEditor/BlockEditor. Defaults to false →
// the FileUpload primitive shows its URL-paste fallback.
const BlobConfigContext = React.createContext(false);

export function BlobConfigProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <BlobConfigContext.Provider value={value}>
      {children}
    </BlobConfigContext.Provider>
  );
}

function useBlobConfigured(): boolean {
  return React.useContext(BlobConfigContext);
}

export interface BranchTarget {
  value: string;
  label: string;
}

/**
 * The branch picker only ever offers FORWARD targets. A stored value that is
 * no longer one of them (a section was moved or deleted) is still shown — as a
 * flagged item — so the author can see what the validator is complaining about
 * instead of staring at an empty dropdown.
 */
export function withCurrentTarget(
  targets: readonly BranchTarget[],
  current: string | undefined,
): BranchTarget[] {
  if (!current || targets.some((t) => t.value === current)) return [...targets];
  return [...targets, { value: current, label: `${current} — invalid target` }];
}

function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function Labelled({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

/** Free option value within one question — allocated once, never re-derived. */
function allocateOptionValue(options: readonly QuestionOption[]): string {
  const taken = new Set(options.map((o) => o.value));
  let n = options.length + 1;
  while (taken.has(`option_${n}`)) n += 1;
  return `option_${n}`;
}

/** Free grid row id — allocated once (it keys the per-row response map). */
function allocateRowId(rows: readonly { id: string }[]): string {
  const taken = new Set(rows.map((r) => r.id));
  let n = rows.length + 1;
  while (taken.has(`row_${n}`)) n += 1;
  return `row_${n}`;
}

/** Free grid column value — allocated once (it is the stored answer). */
function allocateColumnValue(columns: readonly { value: string }[]): string {
  const taken = new Set(columns.map((c) => c.value));
  let n = columns.length + 1;
  while (taken.has(`col_${n}`)) n += 1;
  return `col_${n}`;
}

export function BlockEditor({
  block,
  pageIndex,
  blockIndex,
  total,
  issues,
  branchTargets,
  onChange,
  onConvert,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: PageBlock;
  pageIndex: number;
  blockIndex: number;
  total: number;
  issues: readonly DefinitionIssue[];
  /** Sections this block may branch to (forward only) + "Submit". */
  branchTargets: readonly BranchTarget[];
  onChange: (next: PageBlock) => void;
  onConvert: (kind: PaletteKind) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const paletteKind = blockPaletteKind(block);
  const entry = PALETTE_BY_KIND[paletteKind];
  const Icon = entry.icon;
  const mine = blockIssues(issues, pageIndex, blockIndex);
  const ownIssues = mine.filter((i) => !/options(\[|\.)\d/.test(i.path));

  return (
    <Card
      className={cn(
        "border-l-4",
        mine.length > 0 ? "border-l-destructive" : "border-l-transparent",
      )}
    >
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <GripVertical
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Icon className="h-3 w-3" aria-hidden />
            {entry.short}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {block.id}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move up"
              disabled={blockIndex === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move down"
              disabled={blockIndex === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Duplicate block"
              onClick={onDuplicate}
            >
              <Copy aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove block"
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_13rem]">
          {isAnswerableBlock(block) ? (
            <Input
              value={block.prompt}
              onChange={(e) => onChange({ ...block, prompt: e.target.value })}
              placeholder="Question prompt"
              aria-label="Question prompt"
            />
          ) : block.kind === "info_block" ? (
            <Input
              value={block.heading ?? ""}
              onChange={(e) =>
                onChange({ ...block, heading: e.target.value || undefined })
              }
              placeholder="Heading (optional)"
              aria-label="Info heading"
            />
          ) : (
            <Input
              value={block.caption ?? ""}
              onChange={(e) =>
                onChange({ ...block, caption: e.target.value || undefined })
              }
              placeholder="Caption (optional)"
              aria-label="Image caption"
            />
          )}
          <Select
            value={paletteKind}
            onValueChange={(v) => onConvert(v as PaletteKind)}
          >
            <SelectTrigger aria-label="Block type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PALETTE.map((p) => (
                <SelectItem key={p.kind} value={p.kind}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isAnswerableBlock(block) ? (
          <Input
            value={"helper" in block ? (block.helper ?? "") : ""}
            onChange={(e) =>
              onChange({ ...block, helper: e.target.value || undefined })
            }
            placeholder="Helper text (optional)"
            aria-label="Helper text"
          />
        ) : null}

        <BlockBody
          block={block}
          pageIndex={pageIndex}
          blockIndex={blockIndex}
          issues={issues}
          branchTargets={branchTargets}
          onChange={onChange}
        />

        {isAnswerableBlock(block) && "required" in block ? (
          <div className="border-t border-border pt-3">
            <ToggleRow
              label="Required"
              hint="Only if a missing answer genuinely blocks the burn."
              checked={block.required}
              onCheckedChange={(required) => onChange({ ...block, required })}
            />
          </div>
        ) : null}

        <IssueNote issues={ownIssues} />
      </CardContent>
    </Card>
  );
}

function BlockBody({
  block,
  pageIndex,
  blockIndex,
  issues,
  branchTargets,
  onChange,
}: {
  block: PageBlock;
  pageIndex: number;
  blockIndex: number;
  issues: readonly DefinitionIssue[];
  branchTargets: readonly BranchTarget[];
  onChange: (next: PageBlock) => void;
}) {
  switch (block.kind) {
    case "info_block":
      return (
        <Labelled label="Body" hint="Shown to respondents; takes no answer.">
          <Textarea
            value={block.body}
            onChange={(e) => onChange({ ...block, body: e.target.value })}
            rows={3}
            placeholder="The information you want people to read."
          />
        </Labelled>
      );

    case "image_block":
      return <ImageBlockBody block={block} onChange={onChange} />;

    case "single_select":
    case "multi_select":
      return (
        <ChoiceBody
          block={block}
          pageIndex={pageIndex}
          blockIndex={blockIndex}
          issues={issues}
          branchTargets={branchTargets}
          onChange={onChange}
        />
      );

    case "multi_choice_grid":
    case "checkbox_grid":
      return <GridBody block={block} onChange={onChange} />;

    case "short_text":
      return <ShortTextBody block={block} onChange={onChange} />;

    case "long_text":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Labelled label="Placeholder">
            <Input
              value={block.placeholder ?? ""}
              onChange={(e) =>
                onChange({ ...block, placeholder: e.target.value || undefined })
              }
            />
          </Labelled>
          <Labelled label="Min length">
            <Input
              type="number"
              min={0}
              value={block.minLength ?? ""}
              onChange={(e) =>
                onChange({
                  ...block,
                  minLength: numberOrUndefined(e.target.value),
                })
              }
            />
          </Labelled>
          <Labelled label="Max length">
            <Input
              type="number"
              min={1}
              value={block.maxLength}
              onChange={(e) =>
                onChange({
                  ...block,
                  maxLength: numberOrUndefined(e.target.value) ?? 1,
                })
              }
            />
          </Labelled>
        </div>
      );

    case "linear_scale":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Starts at">
              <Select
                value={String(block.min)}
                onValueChange={(v) =>
                  onChange({ ...block, min: v === "0" ? 0 : 1 })
                }
              >
                <SelectTrigger aria-label="Scale start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0</SelectItem>
                  <SelectItem value="1">1</SelectItem>
                </SelectContent>
              </Select>
            </Labelled>
            <Labelled label="Ends at">
              <Select
                value={String(block.max)}
                onValueChange={(v) => onChange({ ...block, max: Number(v) })}
              >
                <SelectTrigger aria-label="Scale end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labelled>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label={`Label for ${block.min}`}>
              <Input
                value={block.minLabel ?? ""}
                onChange={(e) =>
                  onChange({ ...block, minLabel: e.target.value || undefined })
                }
                placeholder="e.g. Not at all"
              />
            </Labelled>
            <Labelled label={`Label for ${block.max}`}>
              <Input
                value={block.maxLabel ?? ""}
                onChange={(e) =>
                  onChange({ ...block, maxLabel: e.target.value || undefined })
                }
                placeholder="e.g. Completely"
              />
            </Labelled>
          </div>
        </div>
      );

    case "rating":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled label="Steps">
            <Select
              value={String(block.steps)}
              onValueChange={(v) => onChange({ ...block, steps: Number(v) })}
            >
              <SelectTrigger aria-label="Rating steps">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          <Labelled label="Glyph">
            <Select
              value={block.glyph ?? "star"}
              onValueChange={(v) =>
                onChange({
                  ...block,
                  glyph: v as "star" | "heart" | "number",
                })
              }
            >
              <SelectTrigger aria-label="Rating glyph">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="star">Stars</SelectItem>
                <SelectItem value="heart">Hearts</SelectItem>
                <SelectItem value="number">Numbers</SelectItem>
              </SelectContent>
            </Select>
          </Labelled>
        </div>
      );

    case "file_link":
    case "email":
    case "phone":
      return (
        <Labelled
          label="Placeholder"
          hint={
            block.kind === "file_link"
              ? "Respondents paste a link to a file they host — no upload storage yet."
              : undefined
          }
        >
          <Input
            value={block.placeholder ?? ""}
            onChange={(e) =>
              onChange({ ...block, placeholder: e.target.value || undefined })
            }
          />
        </Labelled>
      );

    case "boolean":
    case "date":
    case "time":
    case "years":
      return null;
  }
}

function ShortTextBody({
  block,
  onChange,
}: {
  block: Extract<Question, { kind: "short_text" }>;
  onChange: (next: PageBlock) => void;
}) {
  const numeric = block.format === "number" || block.format === "integer";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Placeholder">
          <Input
            value={block.placeholder ?? ""}
            onChange={(e) =>
              onChange({ ...block, placeholder: e.target.value || undefined })
            }
          />
        </Labelled>
        <Labelled
          label="Answer must be"
          hint="Checked server-side when the answer is submitted."
        >
          <Select
            value={block.format ?? "text"}
            onValueChange={(v) =>
              onChange({
                ...block,
                format: v as NonNullable<typeof block.format>,
                // min/max only mean anything for the numeric presets.
                ...(v === "number" || v === "integer"
                  ? {}
                  : { min: undefined, max: undefined }),
              })
            }
          >
            <SelectTrigger aria-label="Answer format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Any text</SelectItem>
              <SelectItem value="email">An email address</SelectItem>
              <SelectItem value="url">A link</SelectItem>
              <SelectItem value="phone">A phone number</SelectItem>
              <SelectItem value="number">A number</SelectItem>
              <SelectItem value="integer">A whole number</SelectItem>
              <SelectItem value="alphanumeric">Letters and numbers</SelectItem>
            </SelectContent>
          </Select>
        </Labelled>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Labelled label="Min length">
          <Input
            type="number"
            min={0}
            value={block.minLength ?? ""}
            onChange={(e) =>
              onChange({
                ...block,
                minLength: numberOrUndefined(e.target.value),
              })
            }
          />
        </Labelled>
        <Labelled label="Max length">
          <Input
            type="number"
            min={1}
            value={block.maxLength}
            onChange={(e) =>
              onChange({
                ...block,
                maxLength: numberOrUndefined(e.target.value) ?? 1,
              })
            }
          />
        </Labelled>
        <Labelled label="Min value" hint={numeric ? undefined : "Numbers only"}>
          <Input
            type="number"
            disabled={!numeric}
            value={block.min ?? ""}
            onChange={(e) =>
              onChange({ ...block, min: numberOrUndefined(e.target.value) })
            }
          />
        </Labelled>
        <Labelled label="Max value" hint={numeric ? undefined : "Numbers only"}>
          <Input
            type="number"
            disabled={!numeric}
            value={block.max ?? ""}
            onChange={(e) =>
              onChange({ ...block, max: numberOrUndefined(e.target.value) })
            }
          />
        </Labelled>
      </div>
    </div>
  );
}

function ImageBlockBody({
  block,
  onChange,
}: {
  block: ImageBlock;
  onChange: (next: PageBlock) => void;
}) {
  const blobConfigured = useBlobConfigured();
  return (
    <div className="flex flex-col gap-3">
      <Labelled label="Image" hint="Upload or paste a link to the image.">
        <FileUpload
          value={block.url ? [block.url] : []}
          onChange={(urls) => onChange({ ...block, url: urls[0] ?? "" })}
          blobConfigured={blobConfigured}
          handleUploadUrl="/api/blob/upload"
          kind="questionnaire-images"
          variant="image"
          maxFiles={1}
          hint="PNG, JPEG, WebP or GIF, up to 8 MB"
          ariaLabel="Upload questionnaire image"
        />
      </Labelled>
      <Labelled label="Alt text" hint="Required — never ship a blind image.">
        <Input
          value={block.alt}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
          placeholder="What the image shows"
        />
      </Labelled>
    </div>
  );
}

function ChoiceBody({
  block,
  pageIndex,
  blockIndex,
  issues,
  branchTargets,
  onChange,
}: {
  block: Extract<Question, { kind: "single_select" | "multi_select" }>;
  pageIndex: number;
  blockIndex: number;
  issues: readonly DefinitionIssue[];
  branchTargets: readonly BranchTarget[];
  onChange: (next: PageBlock) => void;
}) {
  const single = block.kind === "single_select";
  const showImages = block.display === "image_grid";
  const blobConfigured = useBlobConfigured();
  // Branching is a single-choice-only affordance — the validator rejects a
  // `goTo` on checkboxes, so we never offer one.
  const canBranch = single;

  function setOptions(options: QuestionOption[]) {
    onChange({ ...block, options });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Shown as">
          {single ? (
            <Select
              value={block.display ?? "radio"}
              onValueChange={(v) =>
                onChange({
                  ...block,
                  display: v as "radio" | "dropdown" | "image_grid",
                })
              }
            >
              <SelectTrigger aria-label="Choice display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="radio">Radio buttons</SelectItem>
                <SelectItem value="dropdown">Dropdown</SelectItem>
                <SelectItem value="image_grid">Image grid</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={block.display ?? "checkbox"}
              onValueChange={(v) =>
                onChange({ ...block, display: v as "checkbox" | "image_grid" })
              }
            >
              <SelectTrigger aria-label="Choice display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checkbox">Checkboxes</SelectItem>
                <SelectItem value="image_grid">Image grid</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Labelled>
        {!single ? (
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Min picks">
              <Input
                type="number"
                min={0}
                value={block.minSelections ?? ""}
                onChange={(e) =>
                  onChange({
                    ...block,
                    minSelections: numberOrUndefined(e.target.value),
                  })
                }
              />
            </Labelled>
            <Labelled label="Max picks">
              <Input
                type="number"
                min={1}
                value={block.maxSelections ?? ""}
                onChange={(e) =>
                  onChange({
                    ...block,
                    maxSelections: numberOrUndefined(e.target.value),
                  })
                }
              />
            </Labelled>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">
          Options
        </span>
        {block.options.map((option, optionIndex) => (
          <div key={option.value} className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <Input
                value={option.label}
                onChange={(e) => {
                  const next = [...block.options];
                  next[optionIndex] = { ...option, label: e.target.value };
                  setOptions(next);
                }}
                placeholder={`Option ${optionIndex + 1}`}
                aria-label={`Option ${optionIndex + 1} label`}
              />
              {canBranch ? (
                <Select
                  value={option.goTo ?? CONTINUE}
                  onValueChange={(v) => {
                    const next = [...block.options];
                    next[optionIndex] = {
                      ...option,
                      goTo: v === CONTINUE ? undefined : v,
                    };
                    setOptions(next);
                  }}
                >
                  <SelectTrigger
                    className="w-56 shrink-0"
                    aria-label={`Where option ${optionIndex + 1} goes`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CONTINUE}>
                      Continue to next section
                    </SelectItem>
                    {withCurrentTarget(branchTargets, option.goTo).map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove option ${optionIndex + 1}`}
                disabled={block.options.length <= 2}
                onClick={() =>
                  setOptions(block.options.filter((_, j) => j !== optionIndex))
                }
              >
                <X aria-hidden />
              </Button>
            </div>
            {showImages ? (
              <div className="flex flex-col gap-2 pl-1">
                <FileUpload
                  value={option.imageUrl ? [option.imageUrl] : []}
                  onChange={(urls) => {
                    const next = [...block.options];
                    next[optionIndex] = {
                      ...option,
                      imageUrl: urls[0] || undefined,
                    };
                    setOptions(next);
                  }}
                  blobConfigured={blobConfigured}
                  handleUploadUrl="/api/blob/upload"
                  kind="questionnaire-images"
                  variant="image"
                  maxFiles={1}
                  ariaLabel={`Option ${optionIndex + 1} image`}
                />
                <Input
                  value={option.imageAlt ?? ""}
                  onChange={(e) => {
                    const next = [...block.options];
                    next[optionIndex] = {
                      ...option,
                      imageAlt: e.target.value || undefined,
                    };
                    setOptions(next);
                  }}
                  placeholder="Image alt text"
                  aria-label={`Option ${optionIndex + 1} image alt`}
                />
              </div>
            ) : null}
            <div className="flex items-center gap-2 pl-1">
              <span className="font-mono text-[11px] text-muted-foreground">
                value: {option.value}
              </span>
              {option.goTo ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                  <CornerDownRight className="h-3 w-3" aria-hidden />
                  {option.goTo === SUBMIT_TARGET
                    ? "goes to submit"
                    : `goes to ${option.goTo}`}
                </span>
              ) : null}
            </div>
            <IssueNote
              issues={optionIssues(issues, pageIndex, blockIndex, optionIndex)}
            />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setOptions([
              ...block.options,
              { value: allocateOptionValue(block.options), label: "" },
            ])
          }
        >
          <Plus aria-hidden />
          Add option
        </Button>
        {canBranch ? (
          <p className="text-xs text-muted-foreground">
            Branches only ever move forward — a respondent can never be sent
            back into a section they already answered.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <ToggleRow
          label="Allow an “Other…” answer"
          hint="Adds a free-text option people can type into."
          checked={block.allowOther ?? false}
          onCheckedChange={(allowOther) =>
            onChange({ ...block, allowOther: allowOther || undefined })
          }
        />
        {block.allowOther ? (
          <Labelled label="“Other” label">
            <Input
              value={block.otherLabel ?? ""}
              onChange={(e) =>
                onChange({ ...block, otherLabel: e.target.value || undefined })
              }
              placeholder="Other…"
            />
          </Labelled>
        ) : null}
        <ToggleRow
          label="Shuffle option order"
          hint="Randomised per respondent. Branches follow the option, not its position."
          checked={block.shuffleOptions ?? false}
          onCheckedChange={(shuffleOptions) =>
            onChange({ ...block, shuffleOptions: shuffleOptions || undefined })
          }
        />
      </div>
    </div>
  );
}

function GridBody({
  block,
  onChange,
}: {
  block: Extract<Question, { kind: "multi_choice_grid" | "checkbox_grid" }>;
  onChange: (next: PageBlock) => void;
}) {
  const single = block.kind === "multi_choice_grid";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Rows — the labels down the left; each row keys the response map. */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Rows</span>
        {block.rows.map((row, rowIndex) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.label}
              onChange={(e) => {
                const rows = [...block.rows];
                rows[rowIndex] = { ...row, label: e.target.value };
                onChange({ ...block, rows });
              }}
              placeholder={`Row ${rowIndex + 1}`}
              aria-label={`Row ${rowIndex + 1} label`}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove row ${rowIndex + 1}`}
              disabled={block.rows.length <= 1}
              onClick={() =>
                onChange({
                  ...block,
                  rows: block.rows.filter((_, j) => j !== rowIndex),
                })
              }
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange({
              ...block,
              rows: [
                ...block.rows,
                { id: allocateRowId(block.rows), label: "" },
              ],
            })
          }
        >
          <Plus aria-hidden />
          Add row
        </Button>
      </div>

      {/* Columns — shared across every row. */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">
          Columns
        </span>
        {block.columns.map((column, columnIndex) => (
          <div key={column.value} className="flex items-center gap-2">
            <Input
              value={column.label}
              onChange={(e) => {
                const columns = [...block.columns];
                columns[columnIndex] = { ...column, label: e.target.value };
                onChange({ ...block, columns });
              }}
              placeholder={`Column ${columnIndex + 1}`}
              aria-label={`Column ${columnIndex + 1} label`}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove column ${columnIndex + 1}`}
              disabled={block.columns.length <= 1}
              onClick={() =>
                onChange({
                  ...block,
                  columns: block.columns.filter((_, j) => j !== columnIndex),
                })
              }
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange({
              ...block,
              columns: [
                ...block.columns,
                { value: allocateColumnValue(block.columns), label: "" },
              ],
            })
          }
        >
          <Plus aria-hidden />
          Add column
        </Button>
      </div>

      <p className="text-xs text-muted-foreground sm:col-span-2">
        {single
          ? "Respondents pick one column per row."
          : "Respondents can pick any number of columns per row."}{" "}
        {block.required ? "Every row must be answered." : "Rows are optional."}
      </p>
    </div>
  );
}

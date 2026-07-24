"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Tent,
  Trash2,
  X,
} from "lucide-react";
import type { Question, Questionnaire } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { saveQuestionnaireDefinition } from "@/lib/questionnaires/actions";

// The trimmed builder field kinds (questionnaire-spec: text, textarea, select,
// multi-select, yes_no/consent). Each maps to an engine Question kind.
type BuilderKind =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "boolean";

const KIND_LABELS: Record<BuilderKind, string> = {
  short_text: "Short text",
  long_text: "Paragraph",
  single_select: "Select one",
  multi_select: "Select multiple",
  boolean: "Yes / No",
};

const HAS_OPTIONS = new Set<BuilderKind>(["single_select", "multi_select"]);

interface BuilderField {
  localId: string;
  prompt: string;
  helper: string;
  kind: BuilderKind;
  required: boolean;
  options: string[];
}

export interface BuilderInitial {
  key: string;
  title: string;
  description: string;
  fields: BuilderField[];
}

let localCounter = 0;
function nextLocalId(): string {
  localCounter += 1;
  return `f${localCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyField(kind: BuilderKind = "short_text"): BuilderField {
  return {
    localId: nextLocalId(),
    prompt: "",
    helper: "",
    kind,
    required: kind === "short_text" || kind === "single_select",
    options: HAS_OPTIONS.has(kind) ? ["", ""] : [],
  };
}

/** Map a stored engine Question back into an editable builder field (for edit). */
export function questionToField(q: Question): BuilderField {
  const base = {
    localId: nextLocalId(),
    prompt: q.prompt,
    helper: "helper" in q && q.helper ? q.helper : "",
    required: "required" in q ? q.required : false,
  };
  switch (q.kind) {
    case "single_select":
      return { ...base, kind: "single_select", options: q.options.map((o) => o.label) };
    case "multi_select":
      return { ...base, kind: "multi_select", options: q.options.map((o) => o.label) };
    case "long_text":
      return { ...base, kind: "long_text", options: [] };
    case "boolean":
      return { ...base, kind: "boolean", options: [] };
    default:
      // date / email / phone / years / short_text → editable as short text.
      return { ...base, kind: "short_text", options: [] };
  }
}

function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

/** Turn one builder field into an engine Question (ids deduped by the caller). */
function toQuestion(field: BuilderField, id: string): Question {
  const helper = field.helper.trim() || undefined;
  switch (field.kind) {
    case "short_text":
      return {
        id,
        kind: "short_text",
        prompt: field.prompt.trim(),
        helper,
        maxLength: 200,
        required: field.required,
      };
    case "long_text":
      return {
        id,
        kind: "long_text",
        prompt: field.prompt.trim(),
        helper,
        maxLength: 2000,
        required: field.required,
      };
    case "boolean":
      return {
        id,
        kind: "boolean",
        prompt: field.prompt.trim(),
        helper,
        required: field.required,
      };
    case "single_select":
      return {
        id,
        kind: "single_select",
        prompt: field.prompt.trim(),
        helper,
        options: field.options
          .map((o) => o.trim())
          .filter(Boolean)
          .map((label) => ({ value: slugify(label, label), label })),
        required: field.required,
      };
    case "multi_select":
      return {
        id,
        kind: "multi_select",
        prompt: field.prompt.trim(),
        helper,
        options: field.options
          .map((o) => o.trim())
          .filter(Boolean)
          .map((label) => ({ value: slugify(label, label), label })),
        required: field.required,
      };
  }
}

export function QuestionnaireBuilder({
  initial,
}: {
  initial?: BuilderInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? "",
  );
  const [fields, setFields] = React.useState<BuilderField[]>(
    initial?.fields.length ? initial.fields : [emptyField()],
  );

  function update(localId: string, patch: Partial<BuilderField>) {
    setFields((prev) =>
      prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)),
    );
  }

  function changeKind(localId: string, kind: BuilderKind) {
    setFields((prev) =>
      prev.map((f) =>
        f.localId === localId
          ? {
              ...f,
              kind,
              options: HAS_OPTIONS.has(kind)
                ? f.options.length >= 2
                  ? f.options
                  : ["", ""]
                : [],
            }
          : f,
      ),
    );
  }

  function move(index: number, delta: number) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function remove(localId: string) {
    setFields((prev) => prev.filter((f) => f.localId !== localId));
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  function validate(): string | null {
    if (!title.trim()) return "Give the questionnaire a title.";
    if (fields.length === 0) return "Add at least one question.";
    for (const [i, f] of fields.entries()) {
      if (!f.prompt.trim()) return `Question ${i + 1} needs a prompt.`;
      if (HAS_OPTIONS.has(f.kind)) {
        const opts = f.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) {
          return `Question ${i + 1} ("${f.prompt.trim() || "untitled"}") needs at least two options.`;
        }
      }
    }
    return null;
  }

  function save() {
    const problem = validate();
    if (problem) {
      toast.error("Check the questionnaire", { description: problem });
      return;
    }

    // Dedupe question ids from prompts.
    const seen = new Set<string>();
    const questions: Question[] = fields.map((f, i) => {
      let id = slugify(f.prompt, `field_${i + 1}`);
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return toQuestion(f, id);
    });

    const definition: Questionnaire = {
      version: "1",
      pages: [
        {
          id: "main",
          kind: "questions",
          title: title.trim(),
          subtitle: description.trim() || undefined,
          questions,
        },
      ],
    };

    startTransition(async () => {
      const result = await saveQuestionnaireDefinition({
        key: initial?.key,
        title: title.trim(),
        description: description.trim() || undefined,
        definition,
      });
      if (result.ok) {
        toast.success(initial ? "Questionnaire updated." : "Questionnaire saved.");
        router.push(`/questionnaires/${result.key}/activate`);
        router.refresh();
      } else {
        toast.error("Could not save", { description: result.error });
      }
    });
  }

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
            Ask for the least you need. Mark a field required only if a missing
            answer genuinely blocks the burn.
          </p>
        </div>
      </div>

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
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Questions{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({fields.length})
            </span>
          </h2>
        </div>

        {fields.map((field, index) => (
          <FieldEditor
            key={field.localId}
            field={field}
            index={index}
            total={fields.length}
            onUpdate={(patch) => update(field.localId, patch)}
            onChangeKind={(kind) => changeKind(field.localId, kind)}
            onMove={(delta) => move(index, delta)}
            onRemove={() => remove(field.localId)}
          />
        ))}

        <Button variant="outline" onClick={addField} className="self-start">
          <Plus aria-hidden />
          Add question
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => router.push("/questionnaires")}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending
            ? "Saving…"
            : initial
              ? "Save changes"
              : "Save & choose audience"}
        </Button>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  index,
  total,
  onUpdate,
  onChangeKind,
  onMove,
  onRemove,
}: {
  field: BuilderField;
  index: number;
  total: number;
  onUpdate: (patch: Partial<BuilderField>) => void;
  onChangeKind: (kind: BuilderKind) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <GripVertical
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="text-xs font-medium text-muted-foreground">
            Question {index + 1}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move down"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove question"
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Input
            value={field.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Question prompt"
          />
          <Select
            value={field.kind}
            onValueChange={(v) => onChangeKind(v as BuilderKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as BuilderKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Input
          value={field.helper}
          onChange={(e) => onUpdate({ helper: e.target.value })}
          placeholder="Helper text (optional)"
        />

        {HAS_OPTIONS.has(field.kind) && (
          <OptionsEditor
            options={field.options}
            onChange={(options) => onUpdate({ options })}
          />
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="h-4 w-4 rounded border-input accent-accent"
          />
          <span>Required</span>
        </label>
      </CardContent>
    </Card>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <span className="text-xs font-medium text-muted-foreground">Options</span>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={opt}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={`Option ${i + 1}`}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove option"
            disabled={options.length <= 2}
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            className={cn(options.length <= 2 && "opacity-40")}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...options, ""])}
        className="self-start"
      >
        <Plus aria-hidden />
        Add option
      </Button>
    </div>
  );
}

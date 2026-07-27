"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, GripVertical, Users, Info } from "lucide-react";
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { Badge } from "@quagga/ui/components/badge";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { BlockingBadge } from "./blocking-badge";
import type { createQuestionnaireAction } from "@/app/(app)/camps/[slug]/questionnaires/actions";

type FieldKind =
  "short_text" | "long_text" | "single_select" | "multi_select" | "boolean";

const KIND_LABELS: { value: FieldKind; label: string }[] = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long answer" },
  { value: "single_select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" },
  { value: "boolean", label: "Yes / No" },
];

interface BuilderOption {
  id: string;
  label: string;
}

interface BuilderQuestion {
  localId: string;
  kind: FieldKind;
  prompt: string;
  helper: string;
  required: boolean;
  options: BuilderOption[];
}

interface BuilderRole {
  id: string;
  name: string;
}

interface BuilderMember {
  roleIds: string[];
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function newQuestion(): BuilderQuestion {
  return {
    localId: `q_${genId()}`,
    kind: "short_text",
    prompt: "",
    helper: "",
    required: true,
    options: [
      { id: `o_${genId()}`, label: "" },
      { id: `o_${genId()}`, label: "" },
    ],
  };
}

const isSelectKind = (k: FieldKind) =>
  k === "single_select" || k === "multi_select";

export function QuestionnaireBuilder({
  slug,
  roles,
  members,
  action,
}: {
  slug: string;
  roles: BuilderRole[];
  members: BuilderMember[];
  action: typeof createQuestionnaireAction;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [questions, setQuestions] = React.useState<BuilderQuestion[]>([
    newQuestion(),
  ]);
  const [mode, setMode] = React.useState<"everyone" | "roles">("everyone");
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [blocking, setBlocking] = React.useState(false);
  const [dueAt, setDueAt] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const resolvedCount = React.useMemo(() => {
    if (mode === "everyone") return members.length;
    if (roleIds.length === 0) return 0;
    const wanted = new Set(roleIds);
    return members.filter((m) => m.roleIds.some((id) => wanted.has(id))).length;
  }, [mode, roleIds, members]);

  function patchQuestion(id: string, patch: Partial<BuilderQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => (q.localId === id ? { ...q, ...patch } : q)),
    );
  }

  function validate(): string | null {
    if (!title.trim()) return "Give the questionnaire a title.";
    if (questions.length === 0) return "Add at least one question.";
    for (const q of questions) {
      if (!q.prompt.trim()) return "Every question needs a prompt.";
      if (isSelectKind(q.kind)) {
        const labels = q.options.map((o) => o.label.trim()).filter(Boolean);
        if (labels.length < 2)
          return `"${q.prompt || "A choice question"}" needs at least two options.`;
      }
    }
    if (mode === "roles" && roleIds.length === 0)
      return "Pick at least one role, or send to everyone.";
    return null;
  }

  function buildDefinition() {
    return {
      version: "1",
      pages: [
        {
          id: "page_1",
          kind: "questions" as const,
          title: title.trim(),
          questions: questions.map((q) => {
            const base: Record<string, unknown> = {
              id: q.localId,
              kind: q.kind,
              prompt: q.prompt.trim(),
              required: q.required,
            };
            if (q.helper.trim()) base.helper = q.helper.trim();
            if (isSelectKind(q.kind)) {
              base.options = q.options
                .filter((o) => o.label.trim())
                .map((o) => ({ value: o.id, label: o.label.trim() }));
            }
            return base;
          }),
        },
      ],
    };
  }

  function submit() {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    startTransition(async () => {
      const result = await action({
        slug,
        title: title.trim(),
        description: description.trim() || undefined,
        definition: buildDefinition(),
        mode,
        roleIds: mode === "roles" ? roleIds : [],
        blocking,
        dueAt: dueAt ? dueAt : null,
      });
      if (result.ok) {
        toast.success(
          `Sent to ${result.sent} ${result.sent === 1 ? "member" : "members"}.` +
            (result.emailDelivered
              ? ""
              : " (Email not configured — logged to console.)"),
        );
        router.push(`/camps/${slug}/questionnaires`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          Every question you add is a question someone in the desert has to
          answer. Keep it to what you truly need.
        </span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="q-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Build-week shift preferences"
              maxLength={140}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q-desc" className="text-sm font-medium">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="q-desc"
              value={description}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A sentence on why you're asking."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Questions ({questions.length})
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setQuestions((prev) => [...prev, newQuestion()])}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add question
          </Button>
        </div>

        {questions.map((q, i) => (
          <Card key={q.localId}>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-center gap-2">
                <GripVertical
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Question {i + 1}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <div className="w-40">
                    <Select
                      value={q.kind}
                      onValueChange={(v) =>
                        patchQuestion(q.localId, { kind: v as FieldKind })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_LABELS.map((k) => (
                          <SelectItem key={k.value} value={k.value}>
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove question"
                    onClick={() =>
                      setQuestions((prev) =>
                        prev.filter((x) => x.localId !== q.localId),
                      )
                    }
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <Input
                value={q.prompt}
                onChange={(e) =>
                  patchQuestion(q.localId, { prompt: e.target.value })
                }
                placeholder="Question prompt"
              />
              <Input
                value={q.helper}
                onChange={(e) =>
                  patchQuestion(q.localId, { helper: e.target.value })
                }
                placeholder="Helper text (optional)"
                className="text-sm"
              />

              {isSelectKind(q.kind) && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Options
                  </span>
                  {q.options.map((o, oi) => (
                    <div key={o.id} className="flex items-center gap-2">
                      <Input
                        value={o.label}
                        onChange={(e) =>
                          patchQuestion(q.localId, {
                            options: q.options.map((x) =>
                              x.id === o.id
                                ? { ...x, label: e.target.value }
                                : x,
                            ),
                          })
                        }
                        placeholder={`Option ${oi + 1}`}
                        className="h-9"
                      />
                      <button
                        type="button"
                        aria-label="Remove option"
                        onClick={() =>
                          patchQuestion(q.localId, {
                            options: q.options.filter((x) => x.id !== o.id),
                          })
                        }
                        disabled={q.options.length <= 2}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() =>
                      patchQuestion(q.localId, {
                        options: [
                          ...q.options,
                          { id: `o_${genId()}`, label: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add option
                  </Button>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) =>
                    patchQuestion(q.localId, { required: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-input"
                />
                Required
              </label>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-accent" aria-hidden />
            Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            {(["everyone", "roles"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  mode === m
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {m === "everyone" ? "Everyone in this camp" : "By role"}
              </button>
            ))}
          </div>

          {mode === "roles" &&
            (roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No custom roles yet. Add some from the members card, or send to
                everyone.
              </p>
            ) : (
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={roleIds}
                onValueChange={setRoleIds}
                className="justify-start"
              >
                {roles.map((r) => (
                  <ToggleGroupItem key={r.id} value={r.id}>
                    {r.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ))}

          <p className="text-sm text-muted-foreground">
            Resolves to{" "}
            <span className="font-semibold text-foreground">
              {resolvedCount} {resolvedCount === 1 ? "member" : "members"}
            </span>{" "}
            right now.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Priority</span>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={!blocking}
                onClick={() => setBlocking(false)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  !blocking
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Optional
              </button>
              <button
                type="button"
                aria-pressed={blocking}
                onClick={() => setBlocking(true)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  blocking
                    ? "border-destructive bg-destructive/10 text-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Required (blocks the app)
              </button>
            </div>
            <div>
              <BlockingBadge blocking={blocking} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="q-due" className="text-sm font-medium">
              Due date <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="q-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-48"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <Badge variant="outline">
          {resolvedCount} {resolvedCount === 1 ? "recipient" : "recipients"}
        </Badge>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Sending…" : "Create & send"}
        </Button>
      </div>
    </div>
  );
}

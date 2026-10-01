"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Loader2,
  PlayCircle,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import {
  resolveAudience,
  STRUCTURAL_ROLE_LABELS,
  TENURE_LABELS,
  type AudienceContext,
} from "@quagga/core";
import type {
  CampTenure,
  ProjectAudience,
  ProjectStructuralRole,
  QuestionnaireResponses,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { Input } from "@quagga/ui/components/input";
import { Switch } from "@quagga/ui/components/switch";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { BlockingBadge } from "./blocking-badge";
import { QuestionnaireRunner } from "./runner";
import {
  definitionFromSections,
  newLocalId,
  sectionProblem,
  type OnboardingSectionModel,
} from "./onboarding-model";
import type {
  discardOnboardingDraftAction,
  saveOnboardingDraftAction,
  sendOnboardingAction,
} from "@/app/(app)/camps/[slug]/questionnaires/onboarding-actions";

// The onboarding builder (canvas A2). Sections on the left — each one is a
// step the member walks — and on the right who gets it, blocking, and a due
// date. Edits save automatically to the DRAFT; nothing reaches anyone until
// Send. The live "Reaches N of M" count runs the same @quagga/core resolver
// the server runs at send time, over counts-only member facts (no names, no
// ids reach this component).

const AUTOSAVE_MS = 1200;

export interface OnboardingBuilderMember {
  role: ProjectStructuralRole | "other";
  tenure: CampTenure;
  roleIds: string[];
}

export interface OnboardingBuilderProps {
  slug: string;
  activationId: string;
  campName: string;
  editionName: string;
  returnHref: string;
  completionHref: string;
  carriedFrom: string | null;
  initial: {
    title: string;
    sections: OnboardingSectionModel[];
    audience: {
      mode: "everyone" | "roles";
      roleIds: string[];
      tenure: CampTenure[];
      structuralRoles: ProjectStructuralRole[];
    };
    blocking: boolean;
    dueAt: string | null;
  };
  roles: { id: string; name: string; kind: string }[];
  members: OnboardingBuilderMember[];
  scope: { mayBlock: boolean; canTargetEveryone: boolean; roleIds: string[] };
  actions: {
    save: typeof saveOnboardingDraftAction;
    send: typeof sendOnboardingAction;
    discard: typeof discardOnboardingDraftAction;
  };
}

type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function OnboardingBuilder(props: OnboardingBuilderProps) {
  const router = useRouter();
  const { slug, activationId, actions } = props;
  const [title, setTitle] = React.useState(props.initial.title);
  const [sections, setSections] = React.useState(props.initial.sections);
  const [tenure, setTenure] = React.useState<CampTenure[]>(
    props.initial.audience.tenure,
  );
  const [structural, setStructural] = React.useState<ProjectStructuralRole[]>(
    props.initial.audience.structuralRoles,
  );
  const [roleIds, setRoleIds] = React.useState<string[]>(
    props.initial.audience.mode === "roles"
      ? props.initial.audience.roleIds
      : [],
  );
  // A role narrowing whose roles were all deleted (a carried-forward draft)
  // stays a narrowing that reaches nobody — never a silent "everyone" — until
  // the lead picks a role or clears it.
  const [staleNarrowing, setStaleNarrowing] = React.useState(
    props.initial.audience.mode === "roles" &&
      props.initial.audience.roleIds.length === 0,
  );
  const [blocking, setBlocking] = React.useState(props.initial.blocking);
  const [dueAt, setDueAt] = React.useState(props.initial.dueAt ?? "");
  const [editing, setEditing] = React.useState<string | null>(
    props.initial.sections[0]?.id ?? null,
  );
  const [save, setSave] = React.useState<SaveState>({ kind: "saved" });
  const [confirmSend, setConfirmSend] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [isSending, startSend] = React.useTransition();
  const first = React.useRef(true);

  const customRoles = props.roles.filter((r) => r.kind !== "baseline");
  const roleName = React.useMemo(
    () => new Map(props.roles.map((r) => [r.id, r.name])),
    [props.roles],
  );

  const payload = React.useMemo(
    () => ({
      slug,
      activationId,
      title: title.trim(),
      definition: definitionFromSections(sections),
      audience: {
        mode:
          roleIds.length > 0 || staleNarrowing
            ? ("roles" as const)
            : ("everyone" as const),
        roleIds,
        tenure,
        structuralRoles: structural,
      },
      blocking,
      dueAt: dueAt || null,
    }),
    [
      slug,
      activationId,
      title,
      sections,
      roleIds,
      staleNarrowing,
      tenure,
      structural,
      blocking,
      dueAt,
    ],
  );

  // What's wrong, in words, before the server has to say so.
  const problem = React.useMemo(() => {
    if (!title.trim()) return "Give the onboarding a title.";
    if (sections.length === 0) return "Add at least one section.";
    for (const [i, s] of sections.entries()) {
      const p = sectionProblem(s);
      if (p) return `Section ${i + 1}: ${p}`;
    }
    if (tenure.length === 0) return "Pick new, returning, or both.";
    if (structural.length === 0) return "Pick at least one camp role.";
    if (staleNarrowing && roleIds.length === 0)
      return "The roles this was narrowed to no longer exist — pick one, or reach every role.";
    if (roleIds.length === 0 && !props.scope.canTargetEveryone)
      return "Your questionnaire permission covers specific roles — pick one.";
    if (roleIds.some((id) => !props.scope.roleIds.includes(id)))
      return "One of the roles you picked is outside your questionnaire permission.";
    if (blocking && !props.scope.mayBlock)
      return "Your questionnaire permission doesn't allow blocking sends.";
    return null;
  }, [
    title,
    sections,
    tenure,
    structural,
    roleIds,
    staleNarrowing,
    blocking,
    props.scope,
  ]);

  // --- Autosave ---------------------------------------------------------
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave({ kind: "dirty" });
    if (problem) return;
    const timer = window.setTimeout(async () => {
      setSave({ kind: "saving" });
      try {
        const result = await actions.save(payload);
        if (result.ok) setSave({ kind: "saved" });
        else if (result.sent) router.replace(props.completionHref);
        else setSave({ kind: "error", message: result.error });
      } catch {
        setSave({
          kind: "error",
          message: "Couldn't save just now — your edits are still here.",
        });
      }
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // `payload` carries every edit (and `problem` is derived from the same
    // state), so it is the one dependency that means "something changed".
  }, [payload]);

  // --- Live reach, through the same resolver the server uses -------------
  const reach = React.useMemo(() => {
    const spec: ProjectAudience = {
      kind: "project",
      groupId: "camp",
      mode: roleIds.length > 0 || staleNarrowing ? "roles" : "everyone",
      roleIds,
      tenure: tenure.length > 0 ? tenure : ["new", "returning"],
      structuralRoles: structural.length > 0 ? structural : ["member"],
    };
    const ctx: AudienceContext = {
      editionId: "",
      orgGroupId: "",
      memberships: props.members.map((m, i) => ({
        membershipId: `m${i}`,
        userId: `u${i}`,
        groupId: "camp",
        role: m.role === "other" ? "member" : m.role,
        tenure: m.tenure,
      })),
      groups: [],
      registrations: [],
      bios: [],
      roleAssignments: props.members.flatMap((m, i) =>
        m.roleIds.map((projectRoleId) => ({
          membershipId: `m${i}`,
          projectRoleId,
        })),
      ),
      projectRoles: props.roles.map((r) => ({
        id: r.id,
        groupId: "camp",
        kind: r.kind as "baseline",
        officerKey: null,
      })),
    };
    const reached = new Set(resolveAudience(spec, ctx));
    let newCount = 0;
    let returning = 0;
    props.members.forEach((m, i) => {
      if (!reached.has(`u${i}`)) return;
      if (m.tenure === "new") newCount++;
      else returning++;
    });
    return { count: reached.size, newCount, returning };
  }, [roleIds, staleNarrowing, tenure, structural, props.members, props.roles]);

  // --- Section editing ------------------------------------------------------
  function patch(id: string, next: Partial<OnboardingSectionModel>) {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...next } : s)),
    );
  }
  function move(index: number, delta: number) {
    setSections((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });
  }
  function addSection() {
    const id = newLocalId("section");
    setSections((prev) => [
      ...prev,
      { id, heading: "", subtitle: "", body: "", video: null, acks: [] },
    ]);
    setEditing(id);
  }

  const ackCount = sections.reduce((n, s) => n + s.acks.length, 0);

  // --- Send -------------------------------------------------------------------
  function send() {
    if (problem) {
      toast.error(problem);
      return;
    }
    startSend(async () => {
      // Save first: the server sends what it HOLDS, so it must hold this.
      const saved = await actions.save(payload);
      if (!saved.ok) {
        if (saved.sent) router.replace(props.completionHref);
        else toast.error(saved.error);
        return;
      }
      const result = await actions.send({ slug, activationId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Sent to ${result.sent} ${result.sent === 1 ? "member" : "members"}.`,
      );
      router.push(props.completionHref);
      router.refresh();
    });
  }

  function discard() {
    startSend(async () => {
      const result = await actions.discard({ slug, activationId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft discarded.");
      router.push(props.returnHref);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Onboarding</Badge>
          <Badge variant="outline">Draft</Badge>
          <BlockingBadge blocking={blocking} />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="onboarding-title" className="sr-only">
              Title
            </label>
            <Input
              id="onboarding-title"
              value={title}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              className="h-auto border-transparent bg-transparent px-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-input focus-visible:px-2"
            />
            <p className="text-sm text-muted-foreground">
              {sections.length} {sections.length === 1 ? "section" : "sections"}{" "}
              · {ackCount}{" "}
              {ackCount === 1 ? "acknowledgement" : "acknowledgements"} · edits
              save automatically · {props.editionName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SaveIndicator state={save} />
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              disabled={sections.length === 0 || Boolean(problem)}
            >
              <Eye className="h-4 w-4" aria-hidden />
              Preview
            </Button>
            <Button
              onClick={() => setConfirmSend(true)}
              disabled={Boolean(problem) || isSending}
            >
              <Send className="h-4 w-4" aria-hidden />
              Send
            </Button>
          </div>
        </div>
        {problem && (
          <p className="text-sm text-muted-foreground" role="status">
            Not ready to send: {problem}
          </p>
        )}
        {props.carriedFrom && (
          <div className="rounded-md border-l-2 border-primary bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              Draft carried forward from {props.carriedFrom}
            </p>
            <p className="text-muted-foreground">
              Read it through before you send — dates and people change.
              Last year&apos;s ticks don&apos;t carry over: everyone answers
              again.
            </p>
          </div>
        )}
        {confirmSend && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
            <span className="text-sm">
              Send to {reach.count} {reach.count === 1 ? "member" : "members"}{" "}
              now?{" "}
              {blocking
                ? "It is REQUIRED — it blocks the app for them until they finish."
                : "It's optional — it doesn't block anything."}{" "}
              People who join later and fit the audience get it too.
            </span>
            <Button size="sm" onClick={send} disabled={isSending}>
              {isSending ? "Sending…" : "Send now"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmSend(false)}
              disabled={isSending}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* --- Sections --- */}
        <div className="flex flex-col gap-4">
          {sections.map((s, i) => {
            const open = editing === s.id;
            const issue = sectionProblem(s);
            return (
              <Card
                key={s.id}
                className={cn(open && "border-primary")}
                data-testid="onboarding-section"
              >
                <CardHeader className="gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-col items-start text-left"
                      onClick={() => setEditing(open ? null : s.id)}
                      aria-expanded={open}
                    >
                      <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                        Section {i + 1} of {sections.length}
                      </span>
                      <span className="text-base font-semibold">
                        {s.heading || "Untitled section"}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move section ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move section ${i + 1} down`}
                        disabled={i === sections.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove section ${i + 1}`}
                        disabled={sections.length <= 1}
                        onClick={() =>
                          setSections((prev) =>
                            prev.filter((x) => x.id !== s.id),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                  {!open && s.body && (
                    <CardDescription className="line-clamp-2 whitespace-pre-wrap">
                      {s.body}
                    </CardDescription>
                  )}
                  {issue && (
                    <p className="text-xs text-destructive">{issue}</p>
                  )}
                </CardHeader>
                {open && (
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`${s.id}-heading`}
                        className="text-sm font-medium"
                      >
                        Heading
                      </label>
                      <Input
                        id={`${s.id}-heading`}
                        value={s.heading}
                        maxLength={120}
                        onChange={(e) =>
                          patch(s.id, { heading: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`${s.id}-body`}
                        className="text-sm font-medium"
                      >
                        Text
                      </label>
                      <Textarea
                        id={`${s.id}-body`}
                        value={s.body}
                        rows={5}
                        maxLength={4000}
                        onChange={(e) => patch(s.id, { body: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Plain text; line breaks are kept. Keep it short —
                        people read this on a phone.
                      </p>
                    </div>

                    {s.video ? (
                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <PlayCircle
                              className="h-4 w-4 text-accent"
                              aria-hidden
                            />
                            Video link
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => patch(s.id, { video: null })}
                          >
                            Remove
                          </Button>
                        </div>
                        <Input
                          aria-label="Video title"
                          placeholder="A walk around camp (3 min)"
                          value={s.video.title}
                          maxLength={140}
                          onChange={(e) =>
                            patch(s.id, {
                              video: { ...s.video!, title: e.target.value },
                            })
                          }
                        />
                        <Input
                          aria-label="Video link"
                          placeholder="https://…"
                          value={s.video.url}
                          maxLength={2000}
                          onChange={(e) =>
                            patch(s.id, {
                              video: { ...s.video!, url: e.target.value },
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Linked, not uploaded — we never host video. It shows
                          as a card that opens in a new tab.
                        </p>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() =>
                          patch(s.id, { video: { title: "", url: "" } })
                        }
                      >
                        <PlayCircle className="h-4 w-4" aria-hidden />
                        Add a video link
                      </Button>
                    )}

                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium">
                        Acknowledgements
                      </span>
                      {s.acks.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Tick boxes campmates tick to finish. None in this
                          section.
                        </p>
                      )}
                      {s.acks.map((a, ai) => (
                        <div key={a.id} className="flex items-center gap-2">
                          <Input
                            aria-label={`Acknowledgement ${ai + 1}`}
                            value={a.prompt}
                            maxLength={300}
                            onChange={(e) =>
                              patch(s.id, {
                                acks: s.acks.map((x) =>
                                  x.id === a.id
                                    ? { ...x, prompt: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove acknowledgement ${ai + 1}`}
                            onClick={() =>
                              patch(s.id, {
                                acks: s.acks.filter((x) => x.id !== a.id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() =>
                          patch(s.id, {
                            acks: [
                              ...s.acks,
                              { id: newLocalId("ack"), prompt: "" },
                            ],
                          })
                        }
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add acknowledgement
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
          <Button variant="outline" className="self-start" onClick={addSection}>
            <Plus className="h-4 w-4" aria-hidden />
            Add section
          </Button>
        </div>

        {/* --- Who gets this / blocking / due --- */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                Who gets this
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Membership</legend>
                <div className="flex flex-wrap gap-2">
                  {(["new", "returning"] as const).map((t) => (
                    <Chip
                      key={t}
                      pressed={tenure.includes(t)}
                      onClick={() => setTenure((prev) => toggle(prev, t))}
                    >
                      {TENURE_LABELS[t]}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  New means this is their first edition with the camp;
                  returning means they were with the camp for an earlier one.
                </p>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Camp role</legend>
                <div className="flex flex-wrap gap-2">
                  {(["lead", "admin", "member"] as const).map((r) => (
                    <Chip
                      key={r}
                      pressed={structural.includes(r)}
                      onClick={() => setStructural((prev) => toggle(prev, r))}
                    >
                      {STRUCTURAL_ROLE_LABELS[r]}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Lead and Co-lead are off by default. Tap either to include
                  them.
                </p>
              </fieldset>

              {(customRoles.length > 0 || staleNarrowing) && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">
                    Only people holding{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {customRoles.map((r) => {
                      const allowed = props.scope.roleIds.includes(r.id);
                      return (
                        <Chip
                          key={r.id}
                          pressed={roleIds.includes(r.id)}
                          disabled={!allowed}
                          title={
                            allowed
                              ? undefined
                              : "Outside your questionnaire permission"
                          }
                          onClick={() => {
                            setStaleNarrowing(false);
                            setRoleIds((prev) => toggle(prev, r.id));
                          }}
                        >
                          {r.name}
                        </Chip>
                      );
                    })}
                  </div>
                  {staleNarrowing && roleIds.length === 0 && (
                    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2 text-xs">
                      <span>
                        Last time this went only to people holding roles that
                        no longer exist, so right now it reaches nobody. Pick
                        a role, or reach every role above.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="self-start"
                        onClick={() => setStaleNarrowing(false)}
                      >
                        Reach every role above
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {roleIds.length === 0
                      ? staleNarrowing
                        ? "No role picked."
                        : "None picked — every role above is reached."
                      : `Only people holding ${roleIds
                          .map((id) => roleName.get(id))
                          .filter(Boolean)
                          .join(" or ")}.`}
                  </p>
                </fieldset>
              )}

              <div className="border-t border-border pt-3">
                <p className="text-sm font-semibold" data-testid="onboarding-reach">
                  Reaches {reach.count} of {props.members.length}{" "}
                  {props.members.length === 1 ? "member" : "members"} right now
                </p>
                <p className="text-xs text-muted-foreground">
                  {reach.newCount} new · {reach.returning} returning to the
                  camp. People who join later and fit get it too.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    Blocking — {blocking ? "on" : "off"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {blocking
                      ? "Campmates can't use the app until they finish."
                      : "Campmates use the app as normal and finish this whenever they like."}
                  </p>
                </div>
                <Switch
                  checked={blocking}
                  onCheckedChange={setBlocking}
                  disabled={!props.scope.mayBlock && !blocking}
                  aria-label="Blocking"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Shows to campmates as <BlockingBadge blocking={blocking} />
              </div>
              <p className="text-xs text-muted-foreground">
                Switch it on only if nobody should use the app until they
                finish — it blocks the whole app for them, not just this camp,
                and shows as Required · blocks until done. Use sparingly.
              </p>
              {!props.scope.mayBlock && (
                <p className="text-xs text-muted-foreground">
                  Your questionnaire permission doesn&apos;t include blocking
                  sends.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-1.5 pt-6">
              <label htmlFor="onboarding-due" className="text-sm font-medium">
                Due <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="onboarding-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            {confirmDiscard ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Discard this draft? It was never sent.
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={discard}
                  disabled={isSending}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDiscard(false)}
                >
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() => setConfirmDiscard(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Discard draft
              </Button>
            )}
            <Button asChild variant="ghost" size="sm" className="self-start">
              <Link href={props.returnHref}>Back to questionnaires</Link>
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview · {title || "Onboarding"}</DialogTitle>
            <DialogDescription>
              What a campmate sees, one step at a time. Nothing you tick here
              is saved.
            </DialogDescription>
          </DialogHeader>
          {previewOpen && !problem && (
            <QuestionnaireRunner
              questionnaire={payload.definition}
              initialResponses={{}}
              submitLabel="Finish onboarding"
              action={async (_r: QuestionnaireResponses) => {
                setPreviewOpen(false);
                return { ok: true };
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Chip({
  pressed,
  disabled,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-primary bg-primary/10 text-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (state.kind === "dirty") {
    return (
      <span className="text-xs text-muted-foreground">Unsaved changes</span>
    );
  }
  if (state.kind === "error") {
    return (
      <span className="text-xs text-destructive" role="status">
        Not saved — {state.message}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="onboarding-saved"
    >
      <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      Saved
    </span>
  );
}

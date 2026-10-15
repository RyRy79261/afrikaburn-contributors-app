"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Plus, X } from "lucide-react";
import {
  TEAM_DESCRIPTION_MAX,
  TEAM_JOIN_MODES,
  TEAM_MAX_LEADS,
  TEAM_NAME_MAX,
  type TeamJoinMode,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@quagga/ui/components/popover";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import {
  archiveTeamAction,
  createTeamAction,
  setTeamLeadAction,
  updateTeamAction,
} from "@/app/(app)/camps/[slug]/teams/actions";
import { PeoplePicker, type PickablePerson } from "./people-picker";

const JOIN_MODE_COPY: Record<TeamJoinMode, { title: string; help: string }> = {
  open: { title: "Open", help: "Members join with one tap." },
  leads_add: {
    title: "Leads add only",
    help: "Team leads and camp leads add people.",
  },
};

/** The team being edited, as the team page has it. */
export interface EditableTeam {
  id: string;
  name: string;
  description: string | null;
  joinMode: TeamJoinMode;
  archived: boolean;
  /** Everyone on the team; `isLead` marks its leads. */
  members: (PickablePerson & { isLead: boolean })[];
}

/**
 * New team (frame T1 state 2) and Edit team (frame T2 state 3): name, what
 * the team does (markdown), who can join and its team leads. Edit adds
 * Archive / Restore for camp leads. Every write goes through a server action
 * that re-parses with Zod and re-decides with @quagga/core.
 */
export function TeamForm({
  slug,
  team,
  leadCandidates = [],
  canArchive = false,
  onDone,
}: {
  slug: string;
  /** Absent: a new team. */
  team?: EditableTeam;
  /** New team only: the camp's members a lead may be chosen from. */
  leadCandidates?: readonly PickablePerson[];
  canArchive?: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = team !== undefined;
  const [name, setName] = React.useState(team?.name ?? "");
  const [description, setDescription] = React.useState(team?.description ?? "");
  const [joinMode, setJoinMode] = React.useState<TeamJoinMode>(
    team?.joinMode ?? "open",
  );
  const initialLeads = React.useMemo(
    () =>
      new Set(
        team ? team.members.filter((m) => m.isLead).map((m) => m.userId) : [],
      ),
    [team],
  );
  const [leads, setLeads] = React.useState<Set<string>>(initialLeads);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const nameOf = new Map(
    (team ? team.members : leadCandidates).map((p) => [
      p.userId,
      p.displayName,
    ]),
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the team a name.");
      return;
    }
    startTransition(async () => {
      if (!team) {
        const result = await createTeamAction({
          slug,
          name,
          description,
          joinMode,
          leadUserIds: [...leads],
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success(`${name.trim()} is made, with its team chat.`);
        onDone();
        router.push(`/camps/${slug}/teams/${result.id}`);
        return;
      }
      const result = await updateTeamAction({
        slug,
        teamId: team.id,
        name,
        description,
        joinMode,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Lead changes are one write per person; the first refusal stops here
      // and says why — what already saved stays saved.
      const changes = team.members.filter(
        (m) => m.isLead !== leads.has(m.userId),
      );
      for (const m of changes) {
        const r = await setTeamLeadAction({
          slug,
          teamId: team.id,
          userId: m.userId,
          isLead: leads.has(m.userId),
        });
        if (!r.ok) {
          setError(r.error);
          router.refresh();
          return;
        }
      }
      toast.success("Team saved.");
      onDone();
      router.refresh();
    });
  }

  function archive(archived: boolean) {
    if (!team) return;
    setError(null);
    startTransition(async () => {
      const result = await archiveTeamAction({
        slug,
        teamId: team.id,
        archived,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        archived
          ? `${team.name} is archived. Its chat is read-only.`
          : `${team.name} is back on the list.`,
      );
      onDone();
      router.refresh();
    });
  }

  const nonLeads = team ? team.members.filter((m) => !leads.has(m.userId)) : [];

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <Field label="Team name" htmlFor="team-name" required>
        <Input
          id="team-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={TEAM_NAME_MAX}
          placeholder="e.g. Shade crew"
        />
      </Field>

      <Field
        label="What the team does (optional)"
        htmlFor="team-description"
        help="Markdown. Everyone in the camp can read it."
      >
        <MarkdownEditor
          value={description}
          onChange={(v) => setDescription(v.slice(0, TEAM_DESCRIPTION_MAX))}
          ariaLabel="What the team does"
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Who can join</legend>
        {TEAM_JOIN_MODES.map((mode) => (
          <label
            key={mode}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40",
              joinMode === mode && "border-primary bg-primary/10",
            )}
          >
            <input
              type="radio"
              name="team-join-mode"
              value={mode}
              checked={joinMode === mode}
              onChange={() => setJoinMode(mode)}
              className="mt-1 accent-primary"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">
                {JOIN_MODE_COPY[mode].title}
              </span>
              <span className="text-xs text-muted-foreground">
                {JOIN_MODE_COPY[mode].help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {editing ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" id="team-leads-label">
            Team leads
          </span>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-labelledby="team-leads-label"
          >
            {[...leads].map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md border border-primary/60 bg-primary/10 py-1 pl-3 pr-1 text-sm"
              >
                {nameOf.get(id) ?? "Someone"}
                <button
                  type="button"
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Stop ${nameOf.get(id) ?? "them"} being a team lead`}
                  onClick={() => {
                    const next = new Set(leads);
                    next.delete(id);
                    setLeads(next);
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ))}
            {nonLeads.length > 0 && leads.size < TEAM_MAX_LEADS && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    <Plus className="h-4 w-4" aria-hidden />
                    Add a lead
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-1">
                  <ul className="flex max-h-60 flex-col overflow-y-auto">
                    {nonLeads.map((m) => (
                      <li key={m.userId}>
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => setLeads(new Set(leads).add(m.userId))}
                        >
                          {m.displayName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Team leads come from the people on the team. They edit this page,
            add and remove people and set the chat&apos;s timer.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Team leads (optional)</span>
          <PeoplePicker
            people={leadCandidates}
            selected={leads}
            onChange={(next) => {
              if (next.size <= TEAM_MAX_LEADS) setLeads(next);
            }}
            searchLabel="Choose camp members"
            emptyLabel="Nobody else is in the camp yet."
          />
          <p className="text-xs text-muted-foreground">
            Team leads edit the page, add and remove people and set the
            chat&apos;s timer. Each one is told they were added.
          </p>
          <p className="text-xs text-muted-foreground">
            Creating the team also makes its team chat.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {confirmArchive && team && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
          <p className="text-sm">
            Archive {team.name}? It leaves the list, and its chat becomes
            read-only. Its people, shifts and messages stay.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => archive(true)}
            >
              Archive team
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmArchive(false)}
            >
              Keep it
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {team && canArchive && !confirmArchive && (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "sm:mr-auto",
              !team.archived && "text-destructive hover:text-destructive",
            )}
            disabled={pending}
            onClick={() =>
              team.archived ? archive(false) : setConfirmArchive(true)
            }
          >
            {team.archived ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden />
            ) : (
              <Archive className="h-4 w-4" aria-hidden />
            )}
            {team.archived ? "Restore team" : "Archive team"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className={cn(!(team && canArchive) && "sm:ml-auto")}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {editing ? "Save" : "Create team"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Info } from "lucide-react";
import { formatClock, meetingPath, parseClock } from "@quagga/core";
import { MEETING_LOCATION_MAX, MEETING_TITLE_MAX } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";
import {
  createMeetingAction,
  updateMeetingAction,
} from "@/app/(app)/camps/[slug]/meetings/actions";
import {
  MEETING_DURATION_OPTIONS,
  meetingDurationLabel,
  meetingReach,
  type ReachMember,
} from "@/lib/meeting-view";

// Schedule a meeting / edit a meeting (frame G3 TqtC2 / Cf5Jm). UI only: the
// action parses the whole input with Zod and the store re-decides who may
// schedule, the audience and the version inside its transaction. The reach
// line is a guide computed from the same rule the server uses.
//
// TIME HAS NO ZONE (like shifts): the date and "HH:MM" are stored exactly as
// typed and everyone sees the same numbers.

/** A role the meeting can be for. */
export interface MeetingFormRole {
  id: string;
  name: string;
}

/** The stored meeting, when editing. */
export interface MeetingFormInitial {
  id: string;
  version: number;
  title: string;
  date: string;
  startMinute: number;
  durationMinutes: number;
  location: string | null;
  videoLink: string | null;
  mode: "everyone" | "roles";
  roleIds: string[];
  agendaMd: string;
}

/** True for "https://…" with a host — the form's early check; the server's
 * schema is the real one. */
function looksHttps(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The schedule / edit form. */
export function MeetingForm({
  slug,
  roles,
  members,
  baselineRoleId,
  initial,
}: {
  slug: string;
  roles: MeetingFormRole[];
  members: ReachMember[];
  baselineRoleId: string | null;
  initial?: MeetingFormInitial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [date, setDate] = React.useState(initial?.date ?? "");
  const [startText, setStartText] = React.useState(
    formatClock(initial?.startMinute ?? 19 * 60),
  );
  const [duration, setDuration] = React.useState(
    String(initial?.durationMinutes ?? 60),
  );
  const [location, setLocation] = React.useState(initial?.location ?? "");
  const [videoLink, setVideoLink] = React.useState(initial?.videoLink ?? "");
  const [mode, setMode] = React.useState<"everyone" | "roles">(
    initial?.mode ?? "everyone",
  );
  const [roleIds, setRoleIds] = React.useState<string[]>(
    initial?.roleIds ?? [],
  );
  const [agendaMd, setAgendaMd] = React.useState(initial?.agendaMd ?? "");
  const [error, setError] = React.useState<string | null>(null);

  const start = parseClock(startText);
  const linkError =
    videoLink.trim() && !looksHttps(videoLink)
      ? "Use a link that starts with https:// — plain http and other kinds of link aren't allowed."
      : null;
  const reach = meetingReach(members, { mode, roleIds }, baselineRoleId);
  const durations = [
    ...new Set([
      ...MEETING_DURATION_OPTIONS,
      ...(initial ? [initial.durationMinutes] : []),
    ]),
  ].sort((a, b) => a - b);
  const timingChanged =
    editing &&
    (initial.date !== date ||
      initial.startMinute !== start ||
      initial.durationMinutes !== Number(duration));

  /** Sends the form; on success opens the meeting page. */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) {
      setError("Pick a day.");
      return;
    }
    if (start === null) {
      setError("Type the start time as HH:MM, for example 19:00.");
      return;
    }
    if (linkError) {
      setError(linkError);
      return;
    }
    if (mode === "roles" && roleIds.length === 0) {
      setError("Pick at least one role, or choose the whole camp.");
      return;
    }
    const fields = {
      slug,
      title,
      date,
      startMinute: start,
      durationMinutes: Number(duration),
      location: location.trim(),
      videoLink: videoLink.trim(),
      mode,
      roleIds: mode === "roles" ? roleIds : [],
      agendaMd,
    };
    startTransition(async () => {
      const result = initial
        ? await updateMeetingAction({
            ...fields,
            id: initial.id,
            expectedVersion: initial.version,
          })
        : await createMeetingAction(fields);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Meeting saved." : "Meeting scheduled.");
      const id = initial?.id ?? ("id" in result ? result.id : null);
      router.push(id ? meetingPath(slug, id) : `/camps/${slug}/meetings`);
      router.refresh();
    });
  }

  const optionButton = (active: boolean) =>
    cn(
      "min-h-11 flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-input bg-background text-muted-foreground hover:bg-muted",
    );

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <Field
            label="Title"
            htmlFor="meeting-title"
            required
            help="This becomes the notification headline."
          >
            <Input
              id="meeting-title"
              value={title}
              maxLength={MEETING_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Camp call: transport and build crew"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="Date" htmlFor="meeting-date" required>
                <Input
                  id="meeting-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Start time" htmlFor="meeting-start" required>
                <Input
                  id="meeting-start"
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                  maxLength={5}
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                />
              </Field>
              <Field label="Duration" htmlFor="meeting-duration">
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="meeting-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durations.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {meetingDurationLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Shown exactly as you type it. Everyone sees the same date and
              time.
            </p>
          </div>

          {editing && timingChanged && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <CalendarClock
                className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                aria-hidden
              />
              <p className="text-sm">
                You changed when it happens. Saving tells everyone it&apos;s
                for. Fixing the title, place or agenda sends nothing.
              </p>
            </div>
          )}

          <Field
            label="Place"
            htmlFor="meeting-place"
            help="Optional. Leave it empty for a call with no place."
          >
            <Input
              id="meeting-place"
              value={location}
              maxLength={MEETING_LOCATION_MAX}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. At camp, under the shade structure"
            />
          </Field>

          <Field
            label="Call link"
            htmlFor="meeting-link"
            help="Optional. Must start with https://. Only the people it's for see it."
            error={linkError ?? undefined}
          >
            <Input
              id="meeting-link"
              type="url"
              inputMode="url"
              value={videoLink}
              onChange={(e) => setVideoLink(e.target.value)}
              placeholder="https://"
              aria-invalid={linkError ? true : undefined}
            />
          </Field>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium" id="audience-label">
              Who it&apos;s for
            </span>
            <div
              className="flex gap-2"
              role="group"
              aria-labelledby="audience-label"
            >
              {(["everyone", "roles"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={optionButton(mode === m)}
                >
                  {m === "everyone" ? "Whole camp" : "Chosen roles"}
                </button>
              ))}
            </div>
            {mode === "roles" &&
              (roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Your camp has no roles yet — add them in camp settings, or
                  choose the whole camp.
                </p>
              ) : (
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  value={roleIds}
                  onValueChange={setRoleIds}
                  className="flex-wrap justify-start"
                  aria-label="Roles"
                >
                  {roles.map((r) => (
                    <ToggleGroupItem key={r.id} value={r.id}>
                      {r.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              ))}
            <p className="text-sm text-muted-foreground">
              Shows to{" "}
              <span className="font-semibold text-foreground">
                {reach.total} {reach.total === 1 ? "member" : "members"}
              </span>{" "}
              {mode === "everyone"
                ? "— everyone in the camp right now, leads included."
                : `— people in those roles and the camp's ${reach.leads} ${reach.leads === 1 ? "lead" : "leads"}.`}
            </p>
          </div>

          <Field
            label="Agenda"
            htmlFor="meeting-agenda"
            help="Markdown. Anyone the meeting is for can read it."
          >
            <MarkdownEditor
              value={agendaMd}
              onChange={setAgendaMd}
              ariaLabel="Agenda"
            />
          </Field>

          {!editing && (
            <div className="flex items-start gap-2.5 rounded-lg border border-accent/40 bg-accent/10 p-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              <p className="text-sm">
                Everyone it&apos;s for gets an in-app notice now, and again if
                you move or cancel it. Editing the agenda or notes later sends
                nothing.
              </p>
            </div>
          )}

          {error && (
            <p role="status" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !title.trim()}>
              {!editing && <CalendarPlus className="h-4 w-4" aria-hidden />}
              {pending
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Schedule meeting"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                router.push(
                  initial
                    ? meetingPath(slug, initial.id)
                    : `/camps/${slug}/meetings`,
                )
              }
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Minus, Plus } from "lucide-react";
import {
  formatClock,
  parseClock,
  SHIFT_MAX_CAPACITY,
  SHIFT_MAX_DURATION,
  SHIFT_MIN_DURATION,
  SHIFT_NAME_MAX,
  shiftDateLabel,
  type ShiftDay,
  type ShiftPhase,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import {
  createShiftsAction,
  updateShiftAction,
} from "@/app/(app)/camps/[slug]/shifts/actions";
import { TeamsEditor, type TeamItem } from "./teams-editor";

// New shift / edit shift (canvas S2 `Y1tKxt` / `Ebxs3`). Set it up once and
// repeat it across the days you need — one shift per picked day, each
// editable on its own afterwards.
//
// NOT HERE, ON PURPOSE: the canvas's "Reminder" select. Scheduled reminders
// are out of scope for this build (#57), and a control that promises a
// reminder nothing would send is exactly what the house rule forbids.

export interface ShiftFormRole {
  id: string;
  name: string;
  /** How many current members hold it. */
  holders: number;
}

export interface ShiftFormInitial {
  id: string;
  name: string;
  teamId: string | null;
  date: string;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  requiredRoleId: string | null;
  signupMode: "open" | "assign";
}

const PRESETS = [60, 120, 180, 240] as const;
const PHASE_LABEL: Record<ShiftPhase, string> = {
  build: "Build",
  event: "Event",
  strike: "Strike",
};

type Length = `${number}` | "all" | "other";

function lengthFor(start: number, duration: number): Length {
  if (start === 0 && duration === SHIFT_MAX_DURATION) return "all";
  return (PRESETS as readonly number[]).includes(duration)
    ? (`${duration}` as Length)
    : "other";
}

const optionCard =
  "h-auto flex-1 basis-56 flex-col items-start justify-start gap-0.5 border border-input px-3 py-2.5 text-left whitespace-normal";

export function ShiftForm({
  slug,
  days,
  teams: initialTeams,
  roles,
  initial,
}: {
  slug: string;
  days: ShiftDay[];
  teams: TeamItem[];
  roles: ShiftFormRole[];
  /** Present when editing one shift. */
  initial?: ShiftFormInitial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [pending, startTransition] = React.useTransition();
  const [teams, setTeams] = React.useState(initialTeams);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [teamId, setTeamId] = React.useState(initial?.teamId ?? "");
  const [startText, setStartText] = React.useState(
    formatClock(initial?.startMinute ?? 12 * 60),
  );
  const [length, setLength] = React.useState<Length>(
    initial ? lengthFor(initial.startMinute, initial.durationMinutes) : "180",
  );
  const [endText, setEndText] = React.useState(
    formatClock(
      (initial?.startMinute ?? 12 * 60) + (initial?.durationMinutes ?? 180),
    ),
  );
  const [capacity, setCapacity] = React.useState(initial?.capacity ?? 2);
  const [who, setWho] = React.useState<"anyone" | "role">(
    initial?.requiredRoleId ? "role" : "anyone",
  );
  const [roleId, setRoleId] = React.useState(initial?.requiredRoleId ?? "");
  const [dates, setDates] = React.useState<string[]>(
    initial ? [initial.date] : [],
  );
  const [signupMode, setSignupMode] = React.useState<"open" | "assign">(
    initial?.signupMode ?? "open",
  );
  const [error, setError] = React.useState<string | null>(null);

  const allDay = length === "all";
  const start = allDay ? 0 : parseClock(startText);
  const duration: number | null = (() => {
    if (allDay) return SHIFT_MAX_DURATION;
    if (length !== "other") return Number(length);
    const end = parseClock(endText);
    if (start === null || end === null) return null;
    const d = (end - start + 1440) % 1440;
    return d === 0 ? null : d;
  })();
  const timeOk =
    start !== null &&
    duration !== null &&
    duration >= SHIFT_MIN_DURATION &&
    duration <= SHIFT_MAX_DURATION;
  const role = roles.find((r) => r.id === roleId) ?? null;
  const sortedDates = [...dates].sort();
  const base = `/camps/${slug}/shifts`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!timeOk || start === null || duration === null) {
      setError("Check the start and end time.");
      return;
    }
    if (who === "role" && !roleId) {
      setError("Pick the camp role this shift needs.");
      return;
    }
    const fields = {
      slug,
      name,
      teamId: teamId || null,
      startMinute: start,
      durationMinutes: duration,
      capacity,
      requiredRoleId: who === "role" ? roleId : null,
      signupMode,
    };
    startTransition(async () => {
      const result = editing
        ? await updateShiftAction({
            ...fields,
            id: initial!.id,
            date: dates[0] ?? "",
          })
        : await createShiftsAction({ ...fields, dates: sortedDates });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(
        editing
          ? "Shift saved."
          : `Created ${sortedDates.length} shift${sortedDates.length === 1 ? "" : "s"}.`,
      );
      router.push(
        sortedDates[0] ? `${base}?day=${sortedDates[0]}` : base,
      );
      router.refresh();
    });
  }

  const phases: ShiftPhase[] = ["build", "event", "strike"];

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <Field
            label="Shift name"
            htmlFor="shift-name"
            required
            help="What people see in the list."
          >
            <Input
              id="shift-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={SHIFT_NAME_MAX}
              placeholder="e.g. Kitchen · lunch"
              aria-describedby="shift-name-help"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium" id="team-label">
                Team
              </span>
              <TeamsEditor
                slug={slug}
                teams={teams}
                onChange={(next, addedId) => {
                  setTeams(next);
                  if (addedId) setTeamId(addedId);
                  else if (!next.some((t) => t.id === teamId)) setTeamId("");
                }}
              />
            </div>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No teams yet — a shift doesn&apos;t need one.
              </p>
            ) : (
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby="team-label"
                value={teamId}
                onValueChange={setTeamId}
              >
                {teams.map((t) => (
                  <ToggleGroupItem key={t.id} value={t.id}>
                    {t.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Time</legend>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="shift-start" className="text-xs font-medium">
                  Starts
                </label>
                <Input
                  id="shift-start"
                  type="time"
                  className="w-36"
                  value={allDay ? "00:00" : startText}
                  disabled={allDay}
                  onChange={(e) => setStartText(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium" id="length-label">
                  How long
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  aria-labelledby="length-label"
                  value={length}
                  onValueChange={(v) => v && setLength(v as Length)}
                >
                  {PRESETS.map((m) => (
                    <ToggleGroupItem key={m} value={`${m}`}>
                      {m / 60} h
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value="all">All day</ToggleGroupItem>
                  <ToggleGroupItem value="other">Other</ToggleGroupItem>
                </ToggleGroup>
              </div>
              {length === "other" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="shift-end" className="text-xs font-medium">
                    Ends
                  </label>
                  <Input
                    id="shift-end"
                    type="time"
                    className="w-36"
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                  />
                </div>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowRight className="h-4 w-4" aria-hidden />
              {allDay
                ? "All day"
                : timeOk && start !== null && duration !== null
                  ? `Ends ${formatClock(start + duration)}${start + duration >= 1440 ? " (next day)" : ""}`
                  : "Check the times"}
            </p>
          </fieldset>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="capacity-label">
              How many people
            </span>
            <span className="text-xs text-muted-foreground">
              How many you need at the same time.
            </span>
            <div
              className="flex items-center gap-2"
              role="group"
              aria-labelledby="capacity-label"
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Fewer people"
                disabled={capacity <= 1}
                onClick={() => setCapacity((c) => Math.max(1, c - 1))}
              >
                <Minus className="h-4 w-4" aria-hidden />
              </Button>
              <Input
                aria-label="How many people"
                inputMode="numeric"
                className="w-16 text-center"
                value={capacity}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  if (Number.isFinite(n))
                    setCapacity(Math.min(SHIFT_MAX_CAPACITY, Math.max(1, n)));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="More people"
                disabled={capacity >= SHIFT_MAX_CAPACITY}
                onClick={() =>
                  setCapacity((c) => Math.min(SHIFT_MAX_CAPACITY, c + 1))
                }
              >
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="who-label">
              Who can take it (optional skill)
            </span>
            <ToggleGroup
              type="single"
              aria-labelledby="who-label"
              value={who}
              onValueChange={(v) => v && setWho(v as "anyone" | "role")}
              className="items-stretch"
            >
              <ToggleGroupItem value="anyone" className={optionCard}>
                <span className="font-medium">Anyone in the camp</span>
                <span className="text-xs text-muted-foreground">
                  No skill needed.
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="role"
                className={optionCard}
                disabled={roles.length === 0}
              >
                <span className="font-medium">Only people with a role</span>
                <span className="text-xs text-muted-foreground">
                  {roles.length === 0
                    ? "Your camp has no roles yet — add them in camp settings."
                    : "One of your camp's roles."}
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
            {who === "role" && roles.length > 0 && (
              <>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  aria-label="Camp role needed"
                  value={roleId}
                  onValueChange={setRoleId}
                >
                  {roles.map((r) => (
                    <ToggleGroupItem key={r.id} value={r.id}>
                      {r.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {role && (
                  <p className="text-xs text-muted-foreground">
                    {role.holders === 0
                      ? `Nobody holds ${role.name} yet.`
                      : `${role.holders} ${role.holders === 1 ? "person holds" : "people hold"} ${role.name}.`}{" "}
                    Everyone else still sees the shift, but can&apos;t sign up
                    for it.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="text-sm font-medium" id="days-label">
                {editing ? "Day" : "Repeat on"}
              </span>
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "The day this shift runs."
                  : "Tap the days this shift runs."}
              </p>
            </div>
            {phases.map((phase) => {
              const inPhase = days.filter((d) => d.phase === phase);
              if (inPhase.length === 0) return null;
              const items = inPhase.map((d) => (
                <ToggleGroupItem key={d.date} value={d.date} size="sm">
                  {shiftDateLabel(d.date).short}
                </ToggleGroupItem>
              ));
              return (
                <div key={phase} className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {PHASE_LABEL[phase]}
                  </span>
                  {editing ? (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      aria-label={`${PHASE_LABEL[phase]} days`}
                      value={dates[0] ?? ""}
                      onValueChange={(v) => v && setDates([v])}
                    >
                      {items}
                    </ToggleGroup>
                  ) : (
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      aria-label={`${PHASE_LABEL[phase]} days`}
                      value={dates.filter((d) =>
                        inPhase.some((p) => p.date === d),
                      )}
                      onValueChange={(v) =>
                        setDates([
                          ...dates.filter(
                            (d) => !inPhase.some((p) => p.date === d),
                          ),
                          ...v,
                        ])
                      }
                    >
                      {items}
                    </ToggleGroup>
                  )}
                </div>
              );
            })}
            {!editing && (
              <p className="flex items-center gap-2 rounded-md bg-secondary/40 px-3 py-2 text-sm font-medium">
                <CalendarDays className="h-4 w-4 text-accent" aria-hidden />
                {sortedDates.length === 0
                  ? "Pick at least one day."
                  : `Makes ${sortedDates.length} shift${sortedDates.length === 1 ? "" : "s"}, ${
                      sortedDates.length === 1
                        ? shiftDateLabel(sortedDates[0]!).medium
                        : `${shiftDateLabel(sortedDates[0]!).medium} – ${shiftDateLabel(sortedDates.at(-1)!).medium}`
                    } · ${sortedDates.length * capacity} spot${sortedDates.length * capacity === 1 ? "" : "s"} to fill`}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="mode-label">
              How people get on it
            </span>
            <ToggleGroup
              type="single"
              aria-labelledby="mode-label"
              value={signupMode}
              onValueChange={(v) => v && setSignupMode(v as "open" | "assign")}
              className="items-stretch"
            >
              <ToggleGroupItem value="open" className={optionCard}>
                <span className="font-medium">Open sign-up</span>
                <span className="text-xs text-muted-foreground">
                  People pick it themselves. You can still assign.
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="assign" className={optionCard}>
                <span className="font-medium">You assign</span>
                <span className="text-xs text-muted-foreground">
                  It won&apos;t show in Open shifts.
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <p className="text-sm text-muted-foreground">
            People you put on a shift get an in-app notice, and hear about any
            change to its day or time.
          </p>

          {error && (
            <p role="status" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                pending || !name.trim() || dates.length === 0 || !timeOk
              }
            >
              {!editing && <Plus className="h-4 w-4" aria-hidden />}
              {pending
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : sortedDates.length > 1
                    ? `Create ${sortedDates.length} shifts`
                    : "Create shift"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push(base)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

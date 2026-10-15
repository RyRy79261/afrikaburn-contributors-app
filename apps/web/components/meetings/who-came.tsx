"use client";

import * as React from "react";
import { ChevronDown, Users } from "lucide-react";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { toast } from "@quagga/ui/components/toast";
import { setMeetingAttendanceAction } from "@/app/(app)/camps/[slug]/meetings/actions";

// "Who came" (frame G2): a record of who was there, never a register. Note-
// takers get tick boxes over every current member the meeting is for; everyone
// else reads the names. A tick is a set operation on the server, so two
// note-takers ticking different people never conflict. A cancelled meeting
// takes no new ticks (unticking a mistake still works).

const COLLAPSED = 8;

/** One person on the list. */
export interface WhoCamePerson {
  userId: string;
  name: string;
  came: boolean;
}

/** The "Who came" card. `tickList` is null for readers. */
export function WhoCame({
  slug,
  meetingId,
  attendees,
  tickList,
  cancelled,
}: {
  slug: string;
  meetingId: string;
  attendees: { userId: string; name: string }[];
  tickList: WhoCamePerson[] | null;
  cancelled: boolean;
}) {
  const [came, setCame] = React.useState(
    () => new Set((tickList ?? []).filter((p) => p.came).map((p) => p.userId)),
  );
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState(false);

  /** Ticks or unticks one person, optimistically; a refusal puts it back. */
  async function toggle(userId: string, next: boolean) {
    setBusy((b) => new Set(b).add(userId));
    setCame((c) => {
      const s = new Set(c);
      if (next) s.add(userId);
      else s.delete(userId);
      return s;
    });
    const r = await setMeetingAttendanceAction({
      slug,
      id: meetingId,
      userId,
      came: next,
    }).catch(() => ({
      ok: false as const,
      error: "Couldn't save that tick. Try again.",
    }));
    setBusy((b) => {
      const s = new Set(b);
      s.delete(userId);
      return s;
    });
    if (!r.ok) {
      toast.error(r.error);
      setCame((c) => {
        const s = new Set(c);
        if (next) s.delete(userId);
        else s.add(userId);
        return s;
      });
    }
  }

  const list = tickList ?? [];
  const shown = expanded ? list : list.slice(0, COLLAPSED);

  return (
    <section
      aria-labelledby="who-came-heading"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
    >
      <div>
        <h2
          id="who-came-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <Users className="h-4 w-4 text-primary" aria-hidden />
          Who came
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ticked by the note-taker. A record of who was there, not a register.
        </p>
      </div>

      {tickList ? (
        <>
          <p className="text-sm">
            <span className="font-semibold">
              {came.size} of {list.length}
            </span>{" "}
            <span className="text-muted-foreground">ticked</span>
          </p>
          <ul className="flex flex-col">
            {shown.map((p) => {
              const checked = came.has(p.userId);
              return (
                <li key={p.userId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                    <Checkbox
                      checked={checked}
                      disabled={busy.has(p.userId) || (cancelled && !checked)}
                      onChange={(e) =>
                        void toggle(p.userId, e.currentTarget.checked)
                      }
                    />
                    {p.name}
                  </label>
                </li>
              );
            })}
          </ul>
          {list.length > COLLAPSED && (
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1 text-sm font-medium"
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show fewer" : `Show all ${list.length} members`}
              <ChevronDown
                className={`h-4 w-4 text-primary transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          )}
          {cancelled && (
            <p className="text-xs text-muted-foreground">
              This meeting was cancelled, so nobody new can be ticked.
            </p>
          )}
        </>
      ) : attendees.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody ticked yet.</p>
      ) : (
        <>
          <p className="text-sm font-semibold">{attendees.length} came</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {attendees.map((a) => (
              <li key={a.userId}>{a.name}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

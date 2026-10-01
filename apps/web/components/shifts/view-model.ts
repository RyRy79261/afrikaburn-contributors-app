// Pure view helpers for the Shifts pages (epic #57). Every "can they?" here is
// answered by the same @quagga/core predicates the store enforces, so a list
// never offers an action the server would refuse. Display only — the store
// re-decides inside its transaction whatever this file says.

import {
  clashesWith,
  formatShiftTime,
  holdsShiftSkill,
  shiftDateLabel,
} from "@quagga/core";
import type {
  ShiftMemberView,
  ShiftView,
} from "@/lib/shifts-store";
import type { AssignCandidate } from "./assign-dialog";

/** "Kitchen · lunch, Thu 29 Apr, 12:00–15:00". */
export function shiftLabel(s: ShiftView): string {
  return `${s.name}, ${shiftDateLabel(s.date).medium}, ${formatShiftTime(s.startMinute, s.durationMinutes)}`;
}

/** Members who could be put on (or handed) this shift: not on it, holding
 * its camp role if it has one, and free at that time. */
export function candidatesFor(
  shift: ShiftView,
  members: readonly ShiftMemberView[],
  shifts: readonly ShiftView[],
  exclude?: string,
): { candidates: AssignCandidate[]; excludedNote: string | null } {
  let noRole = 0;
  let busy = 0;
  const candidates: AssignCandidate[] = [];
  for (const m of members) {
    if (m.membershipId === exclude) continue;
    if (shift.assignments.some((a) => a.membershipId === m.membershipId)) {
      continue;
    }
    if (!holdsShiftSkill(shift.requiredRoleId, new Set(m.heldRoleIds))) {
      noRole++;
      continue;
    }
    const others = shifts.filter(
      (s) =>
        s.id !== shift.id &&
        s.assignments.some((a) => a.membershipId === m.membershipId),
    );
    if (clashesWith(shift, { otherShifts: others })) {
      busy++;
      continue;
    }
    candidates.push({
      membershipId: m.membershipId,
      displayName: m.displayName,
    });
  }
  const notes: string[] = [];
  if (noRole > 0) {
    notes.push(
      `${noRole} ${noRole === 1 ? "person doesn't" : "people don't"} hold ${shift.requiredRoleName ?? "the role it needs"}`,
    );
  }
  if (busy > 0) {
    notes.push(
      `${busy} ${busy === 1 ? "is" : "are"} on another shift at that time`,
    );
  }
  return {
    candidates,
    excludedNote: notes.length ? `Not listed: ${notes.join("; ")}.` : null,
  };
}

/** Names on a shift, or "Nobody yet". */
export function namesOn(s: ShiftView): string {
  return s.assignments.length
    ? s.assignments.map((a) => a.displayName).join(", ")
    : "Nobody yet";
}

/** "3 shifts · 9 hours" for a member's own schedule. */
export function scheduleSummary(shifts: readonly ShiftView[]): string {
  const minutes = shifts.reduce((n, s) => n + s.durationMinutes, 0);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${shifts.length} shift${shifts.length === 1 ? "" : "s"} · ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Today as `YYYY-MM-DD` (server time; used only for the NEXT badge). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Team audiences on the announcement and meeting forms
// (docs/team-audiences-spec.md, frames knWLt / y2O4gf and bIVG2 / YGauR).
// PURE — the words and counts the "By team" / "Teams" picker shows. Nothing
// here decides anything: the server re-checks every pick in @quagga/core.

/** A team the picker offers. */
export interface TeamOption {
  id: string;
  name: string;
}

/** "Kitchen", "Kitchen and Sound", "Kitchen, Sound and Tea bar". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The chosen teams as the reach line names them: "the Kitchen team" for one
 * team (a name already ending in "team" is not doubled), "Kitchen and Build &
 * strike" for several. Empty when nothing is chosen.
 */
export function teamReachPhrase(names: readonly string[]): string {
  if (names.length === 1) {
    const only = names[0] as string;
    return /\bteam$/i.test(only) ? `the ${only}` : `the ${only} team`;
  }
  return joinNames(names);
}

/**
 * The one-line explanation a team lead without the camp-wide privilege reads
 * above their teams: what they may address, and why the other options are
 * missing. Words follow the form they sit on (frames knWLt and bIVG2).
 */
export function teamLeadNotice(
  ledNames: readonly string[],
  form: "announcement" | "meeting",
): string {
  const pronoun = ledNames.length === 1 ? "it" : "them";
  if (form === "announcement") {
    return `You lead ${joinNames(ledNames)}, so you can send to ${pronoun}. Everyone in this camp and By role need the “Post announcements” privilege.`;
  }
  return `You lead ${joinNames(ledNames)}, so you can schedule for ${pronoun}. Whole camp and Chosen roles need the “Schedule meetings” privilege.`;
}

/** The names of the chosen teams, in the order the picker lists them. */
export function chosenTeamNames(
  teams: readonly TeamOption[],
  chosen: readonly string[],
): string[] {
  const wanted = new Set(chosen);
  return teams.filter((t) => wanted.has(t.id)).map((t) => t.name);
}

/**
 * How many of these members are on at least one chosen team. The forms'
 * guide count; the server's fan-out is the real number.
 */
export function teamMemberCount(
  members: readonly { teamIds?: readonly string[] }[],
  chosen: readonly string[],
): number {
  if (chosen.length === 0) return 0;
  const wanted = new Set(chosen);
  return members.filter((m) => (m.teamIds ?? []).some((id) => wanted.has(id)))
    .length;
}

/**
 * The team a team page's shortcut asked the form to start with (`?team=`),
 * when the form offers it to this viewer — else none. Only an exact match
 * against the offered ids counts, so a team the viewer may not address, a
 * malformed id, or a repeated parameter all open the form without a team
 * chosen; they never widen what the picker shows.
 */
export function preselectedTeamIds(
  param: string | string[] | undefined,
  offered: readonly TeamOption[],
): string[] {
  if (typeof param !== "string") return [];
  return offered.some((t) => t.id === param) ? [param] : [];
}

/** Team seats grouped by person: user id → the team ids they are on. */
export function teamIdsByUser(
  seats: readonly { teamId: string; userId: string }[],
): Map<string, string[]> {
  const byUser = new Map<string, string[]>();
  for (const seat of seats) {
    const list = byUser.get(seat.userId) ?? [];
    list.push(seat.teamId);
    byUser.set(seat.userId, list);
  }
  return byUser;
}

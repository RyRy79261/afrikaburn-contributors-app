// Camp statistics (docs/camp-stats-spec.md, App Spec §5 STATS-*). PURE — no
// I/O, no env, no DB. The web store (apps/web/lib/camp-stats-store.ts) reads
// the rows in a few set-based queries and hands them here; every figure the
// stats page, the member detail and the "Your participation" card show comes
// back from these functions.
//
// ── WHO SEES WHAT ───────────────────────────────────────────────────────────
//
// The camp page (`buildCampStats`) is the ROSTER's audience: one predicate,
// `canViewCampRoster`, so the page can never count more people than the
// roster lists. A refusal is `null`, which the caller renders as the camp's
// ordinary 404. Theme camps only in this epic (`CAMP_STATS_GROUP_KINDS`):
// artwork and vehicle members have no shifts or onboarding yet.
//
// A member's participation summary (`buildMemberParticipation`) is for the
// member themself, or for a roster viewer of the SAME camp — the logistics
// predicate's audience, because the summary carries their logistics.
//
// ── WHAT A FIGURE MAY CARRY ─────────────────────────────────────────────────
//
// The camp page is COUNTS ONLY. No type below has a slot for a name on the
// camp aggregate, and none has a slot for a phone, an emergency contact, an
// ID number or a medical note anywhere.
//
// Per person, the two figures that come from the bio (burns attended, skills)
// are read off the VIEWER'S PROJECTION of that bio (`participationBioView` →
// the same `campmateBioView` / `publicBioView` the profile page renders), so a
// field the member keeps private stays private here too. Nothing widens it.
//
// ── WHO COUNTS ──────────────────────────────────────────────────────────────
//
// Current members only, everywhere but the "former" figure. A former
// (archived) member counts ONLY there. A deleted (sanitised) account counts
// nowhere — not as current, not as former, not on a shift, not on a pass.
//
// Every figure is for the CURRENT edition unless its name says otherwise.

import type {
  CampTenure,
  GroupKind,
  MembershipRole,
  WapListStatus,
} from "@quagga/types";
import {
  canViewCampRoster,
  deriveCampRosterStats,
  type MemberLogistics,
  type RosterAccessContext,
  type RosterProjectRole,
} from "./camp-roster";
import {
  tallyOnboardingCompletion,
  type OnboardingCompletionRow,
  type TenureEdition,
} from "./camp-onboarding";
import {
  isBioComplete,
  publicBioView,
  type BioExtras,
  type BurnerBioFields,
} from "./bio";
import { campmateBioView, type CampmateContext } from "./campmates";
import { isVisibleToCampMates, isVisibleToPublic } from "./privacy";
import { isoDateToMs, summariseShifts } from "./shifts";
import {
  canManageWorkAccessPasses,
  pendingWapRequest,
  totalWapGranted,
  type WapRequestFacts,
} from "./work-access-passes";

// --- Access ----------------------------------------------------------------

/** The group kinds with a stats page. Theme camps only in this epic. */
export const CAMP_STATS_GROUP_KINDS: readonly GroupKind[] = ["theme_camp"];

/**
 * May the viewer open this camp's stats page? Exactly the roster's predicate,
 * narrowed to theme camps. Fail-closed: no membership ⇒ false.
 */
export function canViewCampStats(ctx: RosterAccessContext): boolean {
  if (!CAMP_STATS_GROUP_KINDS.includes(ctx.groupKind)) return false;
  return canViewCampRoster(ctx);
}

/**
 * May the viewer see this member's participation summary? The member
 * themself, or a roster viewer of the SAME camp. `subjectInGroup` is the
 * subject's ACTIVE membership of this camp, loaded server-side — a former
 * member, or someone from another camp, is refused even for a roster viewer.
 */
export function canViewMemberParticipation(input: {
  viewerUserId: string;
  subjectUserId: string;
  subjectInGroup: boolean;
  access: RosterAccessContext;
}): boolean {
  if (!input.subjectInGroup) return false;
  if (!CAMP_STATS_GROUP_KINDS.includes(input.access.groupKind)) return false;
  if (input.viewerUserId === input.subjectUserId) return true;
  return canViewCampRoster(input.access);
}

// --- Dates -----------------------------------------------------------------

const DAY_MS = 86_400_000;
/** South African Standard Time: UTC+2, no daylight saving. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Today as `YYYY-MM-DD` in South African time — the burn's own calendar. */
export function campStatsToday(now: Date): string {
  return new Date(now.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `iso` plus `days` days, or null when `iso` is not a calendar date. */
function addDays(iso: string, days: number): string | null {
  const ms = isoDateToMs(iso);
  if (ms === null) return null;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Has this shift's day passed? Strictly before today: a shift running today
 * has not been held yet. */
export function isShiftDayPassed(date: string, today: string): boolean {
  return date < today;
}

// --- Onboarding status -------------------------------------------------------

export type OnboardingStatus = "completed" | "in_progress" | "not_started";

/**
 * One targeted person's onboarding status, from their required-action row and
 * whether their runner reported progress. `null` for a waived row (not part of
 * the onboarding any more) — the same rule `tallyOnboardingCompletion` counts by.
 */
export function onboardingStatusOf(
  row: Pick<OnboardingCompletionRow, "status" | "started">,
): OnboardingStatus | null {
  if (row.status === "waived") return null;
  if (row.status === "completed") return "completed";
  return row.started === true ? "in_progress" : "not_started";
}

// --- The camp page -----------------------------------------------------------

/** A current or former member as the store hands them over. Nothing named. */
export interface CampStatsMemberInput {
  /** Deleted account (`users.sanitized_at` set) — counts nowhere. */
  sanitized: boolean;
  /** `classifyCampTenure` over camp-held records — never the bio. */
  tenure: CampTenure;
  /** This edition's bio, trimmed to completion and the first-time flag. */
  bio: { completedAt: Date | null; firstTime: boolean } | null;
  /** This edition's logistics, or null when none are set. */
  logistics: MemberLogistics | null;
}

/** One shift this edition, as counted. `filled` counts current, non-deleted
 * members only (the store's join). */
export interface CampStatsShiftInput {
  date: string;
  capacity: number;
  filled: number;
  teamId: string | null;
  teamName: string | null;
  /** The team's sort order (null for "No team", which sorts last). */
  teamSort: number | null;
}

export interface CampStatsOnboardingInput {
  activationId: string;
  title: string;
  /** One row per CURRENT member the onboarding reached (deleted accounts
   * already excluded by the store). */
  rows: readonly OnboardingCompletionRow[];
}

export interface CampStatsPassesInput {
  requests: readonly Pick<
    WapRequestFacts,
    "requested" | "status" | "granted"
  >[];
  /** Passes on the list held by current, non-deleted members. */
  allocated: number;
  listStatus: WapListStatus;
}

export interface CampStatsInput {
  access: RosterAccessContext;
  edition: { startDate: string; endDate: string };
  /** Today (`campStatsToday`). */
  today: string;
  current: readonly CampStatsMemberInput[];
  /** Archived memberships — only `sanitized` is read. */
  former: readonly Pick<CampStatsMemberInput, "sanitized">[];
  /** The most recent SENT onboarding this edition, or null when none. */
  onboarding: CampStatsOnboardingInput | null;
  shifts: readonly CampStatsShiftInput[];
  /** The registration's pass facts, or null when there is no registration. */
  passes: CampStatsPassesInput | null;
}

export interface CampStatsPeople {
  current: number;
  /** New to THIS camp (`classifyCampTenure`). */
  newToCamp: number;
  returning: number;
  /** First AfrikaBurn ever, from this edition's bio first-time flag. */
  firstBurn: number;
  former: number;
}

export interface CampStatsOnboarding {
  activationId: string;
  title: string;
  targeted: number;
  completed: number;
  inProgress: number;
  notStarted: number;
}

export interface CampStatsBios {
  complete: number;
  /** Not confirmed this edition, or no bio at all. */
  incomplete: number;
}

export type ArrivalPhase = "build" | "event" | "strike";

export interface CampStatsArrivalDay {
  date: string;
  phase: ArrivalPhase;
  count: number;
}

export interface CampStatsBuildStrike {
  joiningBuild: number;
  joiningStrike: number;
  arrivalNotSet: number;
  /** Days with at least one arrival, in date order. */
  arrivalsByDay: CampStatsArrivalDay[];
}

export interface CampStatsTeam {
  /** null = shifts with no team. */
  teamId: string | null;
  name: string;
  spots: number;
  filled: number;
  open: number;
}

export interface CampStatsOpenDay {
  date: string;
  /** Shifts on this day with at least one open spot. */
  shifts: number;
  openSpots: number;
}

export interface CampStatsShifts {
  shifts: number;
  spots: number;
  filled: number;
  open: number;
  /** 0–100, rounded down; null when there are no spots. */
  percentFilled: number | null;
  byTeam: CampStatsTeam[];
  /** Shifts with an open spot from today to six days on (seven days). */
  nextSevenDays: {
    from: string;
    to: string;
    shifts: number;
    openSpots: number;
    days: CampStatsOpenDay[];
  };
}

export interface CampStatsPasses {
  granted: number;
  allocated: number;
  left: number;
  listStatus: WapListStatus;
  /** Passes asked in a request the org has not answered yet, or null. */
  pending: number | null;
}

/** The camp page. NUMBERS ONLY — see the module header. */
export interface CampStatsView {
  people: CampStatsPeople;
  /** null when no onboarding was sent this edition. */
  onboarding: CampStatsOnboarding | null;
  bios: CampStatsBios;
  buildStrike: CampStatsBuildStrike;
  /** null when the camp has no shifts this edition. */
  shifts: CampStatsShifts | null;
  /** null when the camp has asked for no passes this edition. */
  passes: CampStatsPasses | null;
}

function arrivalPhase(
  date: string,
  edition: { startDate: string; endDate: string },
): ArrivalPhase {
  if (date < edition.startDate) return "build";
  if (date > edition.endDate) return "strike";
  return "event";
}

/** The Build and strike figures over CURRENT members (deleted already out). */
export function deriveBuildStrikeStats(
  members: readonly Pick<CampStatsMemberInput, "logistics">[],
  edition: { startDate: string; endDate: string },
): CampStatsBuildStrike {
  const roster = deriveCampRosterStats(
    members.map((m) => ({ bio: null, logistics: m.logistics })),
    null,
  );
  const perDay = new Map<string, number>();
  let arrivalNotSet = 0;
  for (const m of members) {
    const date = m.logistics?.arrivalDate ?? null;
    if (date === null) {
      arrivalNotSet += 1;
      continue;
    }
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }
  return {
    joiningBuild: roster.joiningBuild,
    joiningStrike: roster.joiningStrike,
    arrivalNotSet,
    arrivalsByDay: [...perDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, count]) => ({
        date,
        phase: arrivalPhase(date, edition),
        count,
      })),
  };
}

const NO_TEAM = "No team";

/** The Shifts figures, or null when there are none this edition. */
export function deriveShiftStats(
  shifts: readonly CampStatsShiftInput[],
  today: string,
): CampStatsShifts | null {
  if (shifts.length === 0) return null;
  const totals = summariseShifts(shifts);

  const teams = new Map<string, CampStatsTeam & { sort: number | null }>();
  for (const s of shifts) {
    const key = s.teamId ?? "";
    const held = Math.min(s.filled, s.capacity);
    const team = teams.get(key) ?? {
      teamId: s.teamId,
      name: s.teamId ? (s.teamName ?? NO_TEAM) : NO_TEAM,
      sort: s.teamId ? s.teamSort : null,
      spots: 0,
      filled: 0,
      open: 0,
    };
    team.spots += s.capacity;
    team.filled += held;
    team.open += s.capacity - held;
    teams.set(key, team);
  }
  const byTeam = [...teams.values()]
    .sort((a, b) => {
      // "No team" last; then the lead's order; then the name.
      if (a.teamId === null) return 1;
      if (b.teamId === null) return -1;
      const bySort = (a.sort ?? 0) - (b.sort ?? 0);
      return bySort !== 0 ? bySort : a.name.localeCompare(b.name);
    })
    .map(({ sort: _sort, ...team }) => team);

  const to = addDays(today, 6) ?? today;
  const days = new Map<string, CampStatsOpenDay>();
  for (const s of shifts) {
    if (s.date < today || s.date > to) continue;
    const open = s.capacity - Math.min(s.filled, s.capacity);
    if (open <= 0) continue;
    const day = days.get(s.date) ?? { date: s.date, shifts: 0, openSpots: 0 };
    day.shifts += 1;
    day.openSpots += open;
    days.set(s.date, day);
  }
  const openDays = [...days.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    shifts: totals.shifts,
    spots: totals.spots,
    filled: totals.filled,
    open: totals.open,
    percentFilled: totals.percentFilled,
    byTeam,
    nextSevenDays: {
      from: today,
      to,
      shifts: openDays.reduce((n, d) => n + d.shifts, 0),
      openSpots: openDays.reduce((n, d) => n + d.openSpots, 0),
      days: openDays,
    },
  };
}

/** The Onboarding figures, or null when nothing was sent. */
export function deriveOnboardingStats(
  onboarding: CampStatsOnboardingInput | null,
): CampStatsOnboarding | null {
  if (!onboarding) return null;
  const totals = tallyOnboardingCompletion(onboarding.rows);
  return {
    activationId: onboarding.activationId,
    title: onboarding.title,
    targeted: totals.total,
    completed: totals.complete,
    inProgress: totals.inProgress,
    notStarted: totals.total - totals.complete - totals.inProgress,
  };
}

/** The Work Access Pass figures, or null when the camp has asked for none. */
export function derivePassStats(
  passes: CampStatsPassesInput | null,
): CampStatsPasses | null {
  if (!passes || passes.requests.length === 0) return null;
  const granted = totalWapGranted(passes.requests);
  return {
    granted,
    allocated: passes.allocated,
    left: Math.max(0, granted - passes.allocated),
    listStatus: passes.listStatus,
    pending: pendingWapRequest(passes.requests)?.requested ?? null,
  };
}

/**
 * The camp stats page for a viewer, or `null` (refused) unless they may view
 * it. The refusal comes first, so a caller that forgot its own check still
 * gets nothing back.
 */
export function buildCampStats(input: CampStatsInput): CampStatsView | null {
  if (!canViewCampStats(input.access)) return null;

  const live = input.current.filter((m) => !m.sanitized);
  const former = input.former.filter((m) => !m.sanitized).length;
  // The roster card's own aggregate, so the two can never disagree on build,
  // strike, first-timers, bios or former members. It drops deleted accounts
  // itself; `live` drops them for the figures computed here.
  const roster = deriveCampRosterStats(live, null, former);

  let newToCamp = 0;
  for (const m of live) if (m.tenure === "new") newToCamp += 1;

  return {
    people: {
      current: roster.total,
      newToCamp,
      returning: roster.total - newToCamp,
      firstBurn: roster.newcomers,
      former: roster.former,
    },
    onboarding: deriveOnboardingStats(input.onboarding),
    bios: {
      complete: live.filter((m) => m.bio !== null && isBioComplete(m.bio))
        .length,
      incomplete: live.filter((m) => m.bio === null || !isBioComplete(m.bio))
        .length,
    },
    buildStrike: deriveBuildStrikeStats(live, input.edition),
    shifts: deriveShiftStats(input.shifts, input.today),
    passes: derivePassStats(input.passes),
  };
}

// --- Per person --------------------------------------------------------------

/**
 * The two bio fields the summary reads, as THIS viewer may see them. `null` =
 * the viewer may not see the field; an empty list = they may, and the bio
 * records none (a first burn, no skills listed). The two must never be
 * confused: "not shared" read off an empty-but-shared field reports a privacy
 * choice the member never made.
 */
export interface ParticipationBio {
  attendedYears: number[] | null;
  skills: string[] | null;
}

/**
 * The subject's bio as the viewer may see it — the profile page's own rule:
 * the member themself sees their own; anyone else sees the camp-mate
 * projection when they share a camp and the bio is confirmed, otherwise the
 * public projection. Null when there is no bio this edition.
 *
 * The VALUES always come from that projection; whether a field is shown at
 * all is the same flag predicate the projection itself applies, so this can
 * never be wider than the profile.
 */
export function participationBioView(input: {
  ctx: CampmateContext;
  bio: {
    fields: BurnerBioFields;
    privacyFlags: Readonly<Record<string, unknown>>;
    extras?: BioExtras;
    confirmed: boolean;
  } | null;
}): ParticipationBio | null {
  if (!input.bio) return null;
  if (input.ctx.viewerUserId === input.ctx.subjectUserId) {
    return {
      attendedYears: [...input.bio.fields.attendedYears],
      skills: [...input.bio.fields.skills],
    };
  }
  const flags = input.bio.privacyFlags;
  const campmate = campmateBioView(input.ctx, input.bio);
  const view =
    campmate ?? publicBioView(input.bio.fields, flags, input.bio.extras);
  const shown = (key: "attendedYears" | "skills") =>
    campmate ? isVisibleToCampMates(flags, key) : isVisibleToPublic(flags, key);
  return {
    attendedYears: shown("attendedYears") ? view.attendedYears : null,
    skills: shown("skills") ? view.skills : null,
  };
}

/**
 * The edition year this membership began: the first edition that had not yet
 * ended when the membership was created, or the earliest edition the
 * membership planned logistics for, whichever is earlier. Never later than the
 * current edition.
 */
export function campSinceYear(input: {
  membershipCreatedAt: Date;
  logisticsEditionYears: readonly number[];
  editions: readonly TenureEdition[];
  currentYear: number;
}): number {
  const created = input.membershipCreatedAt.getTime();
  let since = input.currentYear;
  for (const e of input.editions) {
    const lastDay = Date.parse(`${e.endDate}T23:59:59.999Z`);
    if (Number.isNaN(lastDay)) continue;
    if (created <= lastDay && e.year < since) since = e.year;
  }
  for (const y of input.logisticsEditionYears) if (y < since) since = y;
  return since;
}

/** One shift spot the member holds, any edition. */
export interface ParticipationShiftInput {
  date: string;
  editionYear: number;
}

export interface MemberParticipationInput {
  viewerUserId: string;
  access: RosterAccessContext;
  subject: {
    userId: string;
    /** Active membership of THIS camp. False ⇒ refused. */
    inGroup: boolean;
    sanitized: boolean;
    structuralRole: MembershipRole;
    projectRoles: readonly RosterProjectRole[];
    membershipCreatedAt: Date;
  };
  /** `participationBioView` — the viewer's projection of the subject's bio. */
  bio: ParticipationBio | null;
  edition: { year: number };
  editions: readonly TenureEdition[];
  /** Years this membership has logistics for (any edition). */
  logisticsEditionYears: readonly number[];
  /** This edition's logistics, or null. */
  logistics: MemberLogistics | null;
  /** Every spot the member holds on this camp's shifts, every edition. */
  shifts: readonly ParticipationShiftInput[];
  today: string;
  /** Whether the camp SENT an onboarding this edition at all. */
  onboardingSent: boolean;
  /** The subject's row on that onboarding: null when nothing was sent or it
   * did not reach them (they joined after the send). */
  onboarding: Pick<OnboardingCompletionRow, "status" | "started"> | null;
  passes: {
    /** This edition's list status when the member is on it, else null. */
    thisEdition: WapListStatus | null;
    /** The camp's earlier-edition lists the member was on, with each list's
     * status — a list that stayed a draft never became a pass. */
    earlier: readonly { year: number; listStatus: WapListStatus }[];
  };
}

/**
 * The member's onboarding this edition, as the summary says it:
 * a status when they have a live row; `waived` when the lead waived it for
 * them; `not_targeted` when the camp sent one that did not reach them; null
 * when the camp sent none at all. Only null may read "none sent".
 */
export type ParticipationOnboarding =
  OnboardingStatus | "waived" | "not_targeted" | null;

export interface MemberParticipation {
  /** Count of AfrikaBurn years from the bio (0 is a real answer), or null
   * when the viewer may not see them or there is no bio this edition. */
  burnsAttended: number | null;
  withCampSince: number;
  shiftsHeldThisEdition: number;
  shiftsHeldEarlier: number;
  /** null when no plans are set this edition. */
  buildStrike: { joiningBuild: boolean; joiningStrike: boolean } | null;
  onboarding: ParticipationOnboarding;
  roles: { structural: MembershipRole; projectRoles: RosterProjectRole[] };
  /** Skills from the bio ([] = none listed), or null when the viewer may not
   * see them or there is no bio this edition. */
  skills: string[] | null;
  passes: {
    thisEdition: WapListStatus | null;
    /** Whether this viewer would be shown a DRAFT list this edition. When
     * false, a null `thisEdition` says nothing either way — the member may be
     * on a draft — so it must never be rendered as "not on the list". About
     * the viewer, not the subject: it reveals nothing about any list. */
    draftsVisible: boolean;
    /** Earlier editions the member was on a list that left draft. */
    earlierYears: number[];
  };
}

function participationOnboarding(
  input: Pick<MemberParticipationInput, "onboardingSent" | "onboarding">,
): ParticipationOnboarding {
  if (!input.onboardingSent) return null;
  if (!input.onboarding) return "not_targeted";
  return onboardingStatusOf(input.onboarding) ?? "waived";
}

/**
 * A member's participation summary for a viewer, or `null` (refused) unless
 * they may see it. A deleted account has no summary at all.
 */
export function buildMemberParticipation(
  input: MemberParticipationInput,
): MemberParticipation | null {
  if (input.subject.sanitized) return null;
  if (
    !canViewMemberParticipation({
      viewerUserId: input.viewerUserId,
      subjectUserId: input.subject.userId,
      subjectInGroup: input.subject.inGroup,
      access: input.access,
    })
  ) {
    return null;
  }

  let thisEdition = 0;
  let earlier = 0;
  for (const s of input.shifts) {
    if (!isShiftDayPassed(s.date, input.today)) continue;
    if (s.editionYear === input.edition.year) thisEdition += 1;
    else if (s.editionYear < input.edition.year) earlier += 1;
  }

  const years = input.bio?.attendedYears ?? null;
  const skills = input.bio?.skills ?? null;

  // A draft list is the lead's working copy, not a promise: the member never
  // sees it (`wapOwnPassLine`), and neither does a roster viewer who does not
  // manage passes.
  const isSelf = input.viewerUserId === input.subject.userId;
  const seesDraft =
    !isSelf && canManageWorkAccessPasses(input.access.viewerMembership);
  const passThisEdition =
    input.passes.thisEdition === "draft" && !seesDraft
      ? null
      : input.passes.thisEdition;

  return {
    burnsAttended: years ? years.length : null,
    withCampSince: campSinceYear({
      membershipCreatedAt: input.subject.membershipCreatedAt,
      logisticsEditionYears: input.logisticsEditionYears,
      editions: input.editions,
      currentYear: input.edition.year,
    }),
    shiftsHeldThisEdition: thisEdition,
    shiftsHeldEarlier: earlier,
    buildStrike: input.logistics
      ? {
          joiningBuild: input.logistics.joiningBuild,
          joiningStrike: input.logistics.joiningStrike,
        }
      : null,
    onboarding: participationOnboarding(input),
    roles: {
      structural: input.subject.structuralRole,
      projectRoles: input.subject.projectRoles.map((r) => ({
        id: r.id,
        name: r.name,
      })),
    },
    skills: skills ? [...skills] : null,
    passes: {
      thisEdition: passThisEdition,
      draftsVisible: seesDraft,
      // An earlier list that never left draft was never a pass — for anyone,
      // a pass manager included: that edition is over, so the working copy
      // was never sent to AfrikaBurn.
      earlierYears: [
        ...new Set(
          input.passes.earlier
            .filter(
              (p) => p.year < input.edition.year && p.listStatus !== "draft",
            )
            .map((p) => p.year),
        ),
      ].sort((a, b) => a - b),
    },
  };
}

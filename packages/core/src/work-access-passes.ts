// Work Access Passes (epic #53, docs/wap-spec.md, App Spec §9 WAP-*). PURE —
// no I/O, no env, no DB. The stores load every fact these functions read; a
// request names ids and nothing else, and every decision is re-taken
// server-side (UI hiding is never the boundary).
//
//   org opens requests → project requests N → org grants M ≤ N
//     → lead allocates names (≤ total granted) → submits list → org approves
//     ↺ the project may ask for more at any time requests are open
//
// Decisions (Ryan, 12 Oct 2026, #53):
//
//   · The org OPENS requests for an edition; until then no project can ask.
//   · A project may ask for more while requests are open; the org grants on
//     top. Grants only go up — a granted request is never edited down.
//   · Every project type (theme camps, artworks, mutant vehicles).
//   · The org approves the WHOLE list, or returns it with a note.
//   · A person on two lists is SHOWN, not blocked: "Also has a pass from
//     {project}". That project is named even when it is a FREE CAMP — a
//     deliberate, narrow exception to "free camps are undiscoverable to
//     strangers" (AGENTS.md): only to the managers of another project holding
//     the same person, only next to that person, only the project's name.
//     `wapDuplicateHolders` is the one place that computes it.
//   · Dates and build/strike come from the member's own roster plans
//     (`membership_logistics`); the lead may override them on the pass.
//
// WHO MANAGES: the structural lead and co-leads (the irrevocable backstop,
// ./project-permissions). No custom-role privilege yet —
// `canManageWorkAccessPasses` is the ONE place to widen it.
//
// PRIVACY: nothing here takes or emits a hard-locked field (phone, emergency
// contacts, SA ID, passport) or medical notes. The CSV row type has no slot
// for one; a test pins that.

import type {
  GroupKind,
  MembershipRole,
  NotificationPayload,
  RegistrationStatus,
  WapApprovedPass,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";
import { isPermissionBackstop } from "./project-permissions";
import type { MemberLogistics } from "./camp-roster";
import { logisticsWindow } from "./camp-roster";
import { CSV_BOM, escapeCsvField } from "./registration-export";
import { isoDateToMs, shiftDateLabel } from "./shifts";

// --- Constants -------------------------------------------------------------

/** Audit action names (written in the same transaction as the change). */
export const WAP_AUDIT = {
  windowOpen: "wap.requests.open",
  windowClose: "wap.requests.close",
  request: "wap.request.create",
  grant: "wap.request.grant",
  decline: "wap.request.decline",
  allocate: "wap.allocation.create",
  override: "wap.allocation.update",
  remove: "wap.allocation.delete",
  submit: "wap.list.submit",
  approve: "wap.list.approve",
  return: "wap.list.return",
} as const;

/** Registration statuses that may ask for passes: SUBMITTED and still alive.
 * A draft has not been sent; a rejected or withdrawn project is not coming. */
export const WAP_REQUESTABLE_REGISTRATION_STATUSES: readonly RegistrationStatus[] =
  ["submitted", "under_review", "changes_requested", "approved"];

/** The project kinds that hold passes (all three register on `registrations`). */
export const WAP_PROJECT_KINDS: readonly GroupKind[] = [
  "theme_camp",
  "artwork",
  "mutant_vehicle",
];

// --- Authority -------------------------------------------------------------

/**
 * May this member request passes, allocate names, edit overrides and submit
 * the list? The project's structural lead and co-leads only. `null` = not an
 * active member of the project, which is always no.
 */
export function canManageWorkAccessPasses(
  membership: { structuralRole: MembershipRole } | null,
): boolean {
  return membership !== null && isPermissionBackstop(membership.structuralRole);
}

// --- The request window ----------------------------------------------------

export type WapWindowState = "not_opened" | "open" | "closed";

export interface WapWindowFacts {
  wapRequestsOpenAt: Date | null;
  wapRequestsCloseAt: Date | null;
}

/**
 * Where the edition's WAP requests stand at `now`. Open = opened and not
 * closed. A close stamped BEFORE the latest opening belongs to an earlier
 * round (the org closed, then reopened), so it does not shut the new one. A
 * close in the future is a scheduled close — still open until then.
 */
export function wapRequestWindowState(
  edition: WapWindowFacts,
  now: Date,
): WapWindowState {
  const open = edition.wapRequestsOpenAt;
  const close = edition.wapRequestsCloseAt;
  if (!open || open.getTime() > now.getTime()) {
    // Never opened, or only scheduled. A past close with no live opening is
    // still "closed" so the lead page can say requests have ended.
    return close && close.getTime() <= now.getTime() ? "closed" : "not_opened";
  }
  if (
    close &&
    close.getTime() <= now.getTime() &&
    close.getTime() >= open.getTime()
  ) {
    return "closed";
  }
  return "open";
}

export function isWapRequestWindowOpen(
  edition: WapWindowFacts,
  now: Date,
): boolean {
  return wapRequestWindowState(edition, now) === "open";
}

/** The column values the org's Open / Close button writes. Reopening stamps a
 * fresh open time and clears the close, so the state reads unambiguously. */
export function wapWindowPatch(
  action: "open" | "close",
  now: Date,
): Partial<WapWindowFacts> {
  return action === "open"
    ? { wapRequestsOpenAt: now, wapRequestsCloseAt: null }
    : { wapRequestsCloseAt: now };
}

// --- Requests and the total granted --------------------------------------

export interface WapRequestFacts {
  id: string;
  requested: number;
  status: WapRequestStatus;
  granted: number | null;
}

/** Total granted = the SUM of `granted` over the registration's granted rows.
 * Derived, never stored. Pending and declined rows count nothing. */
export function totalWapGranted(
  requests: readonly Pick<WapRequestFacts, "status" | "granted">[],
): number {
  return requests.reduce(
    (n, r) => (r.status === "granted" && r.granted ? n + r.granted : n),
    0,
  );
}

/** Every ask, pending included (the overview's "Requested" column). */
export function totalWapRequested(
  requests: readonly Pick<WapRequestFacts, "requested">[],
): number {
  return requests.reduce((n, r) => n + r.requested, 0);
}

/** The one pending request, if any (the DB allows at most one). */
export function pendingWapRequest<T extends Pick<WapRequestFacts, "status">>(
  requests: readonly T[],
): T | null {
  return requests.find((r) => r.status === "pending") ?? null;
}

// `legacyWapAsk` (the old registration-form count) lives in
// ./registration-export, which every legacy surface — the registration review,
// the project review and the placement CSV — already reads; this module
// imports from that one, so defining it here would make a cycle.

// --- Decisions -------------------------------------------------------------

export type WapRefusal =
  | "not_manager"
  | "window_closed"
  | "not_submitted"
  | "pending_exists"
  | "not_pending"
  | "grant_too_many"
  | "grant_too_few"
  | "no_grant"
  | "cap_reached"
  | "not_member"
  | "already_on_list"
  | "not_on_list"
  | "list_locked"
  | "list_empty"
  | "over_cap"
  | "not_submitted_list"
  | "note_required"
  | "dates_out_of_window"
  | "arrival_after_departure";

export type WapDecision = { ok: true } | { ok: false; reason: WapRefusal };

const refuse = (reason: WapRefusal): WapDecision => ({ ok: false, reason });
const OK: WapDecision = { ok: true };

/**
 * May the project ask for passes (the first time, or for more)? Only its lead
 * or co-leads, only while the edition's requests are open, only for a
 * registration that has been submitted, and not while another is pending.
 */
export function decideWapRequest(input: {
  mayManage: boolean;
  windowOpen: boolean;
  registrationStatus: RegistrationStatus;
  requests: readonly Pick<WapRequestFacts, "status">[];
}): WapDecision {
  if (!input.mayManage) return refuse("not_manager");
  if (!input.windowOpen) return refuse("window_closed");
  if (
    !WAP_REQUESTABLE_REGISTRATION_STATUSES.includes(input.registrationStatus)
  ) {
    return refuse("not_submitted");
  }
  if (pendingWapRequest(input.requests)) return refuse("pending_exists");
  return OK;
}

/**
 * The org grants a request. Only a PENDING one (a granted row is never edited:
 * grants only go up), and only between 1 and the number asked — fewer is
 * allowed, never more.
 */
export function decideWapGrant(
  request: Pick<WapRequestFacts, "status" | "requested">,
  granted: number,
): WapDecision {
  if (request.status !== "pending") return refuse("not_pending");
  if (!Number.isInteger(granted) || granted < 1) return refuse("grant_too_few");
  if (granted > request.requested) return refuse("grant_too_many");
  return OK;
}

/** The org declines a request. Only a pending one. */
export function decideWapDecline(
  request: Pick<WapRequestFacts, "status">,
): WapDecision {
  return request.status === "pending" ? OK : refuse("not_pending");
}

/** Is the list editable in this status? `draft` and `returned` are; so is
 * `approved` (the edit moves it back to draft). `submitted` is locked until
 * the org acts. */
export function isWapListEditable(status: WapListStatus): boolean {
  return status !== "submitted";
}

/**
 * The list status after a lead edits it (add, remove, override). Editing an
 * APPROVED list moves it back to `draft` — the lead must submit again and the
 * org sees what changed. `returned` stays returned (the org's note is still
 * the thing to act on). Throws for `submitted`: callers must check
 * `isWapListEditable` (or a decide* function) first.
 */
export function wapListStatusAfterEdit(status: WapListStatus): WapListStatus {
  switch (status) {
    case "draft":
      return "draft";
    case "returned":
      return "returned";
    case "approved":
      return "draft";
    case "submitted":
      throw new Error("A submitted pass list is locked until the org acts.");
  }
}

/** Who may hold a pass: a CURRENT member of THIS project. Former (archived)
 * members are not; a member of another project is not. */
export function isWapEligibleMember(
  membership: { groupId: string; archivedAt: Date | null } | null,
  projectGroupId: string,
): boolean {
  return (
    membership !== null &&
    membership.groupId === projectGroupId &&
    membership.archivedAt === null
  );
}

/**
 * A lead puts a member on the list. The cap (allocations ≤ total granted) is
 * checked here AND must be re-checked by the store inside a transaction that
 * locks the registration row, with counts read inside that transaction.
 */
export function decideWapAllocate(input: {
  mayManage: boolean;
  listStatus: WapListStatus;
  totalGranted: number;
  allocatedCount: number;
  memberEligible: boolean;
  alreadyOnList: boolean;
}): WapDecision {
  if (!input.mayManage) return refuse("not_manager");
  if (!isWapListEditable(input.listStatus)) return refuse("list_locked");
  if (input.totalGranted <= 0) return refuse("no_grant");
  if (!input.memberEligible) return refuse("not_member");
  if (input.alreadyOnList) return refuse("already_on_list");
  if (input.allocatedCount >= input.totalGranted) return refuse("cap_reached");
  return OK;
}

/** A lead removes a name or edits a pass's overrides. */
export function decideWapEdit(input: {
  mayManage: boolean;
  listStatus: WapListStatus;
  onList: boolean;
}): WapDecision {
  if (!input.mayManage) return refuse("not_manager");
  if (!isWapListEditable(input.listStatus)) return refuse("list_locked");
  if (!input.onList) return refuse("not_on_list");
  return OK;
}

/** The lead sends the list to AfrikaBurn. Not already submitted, not empty,
 * and not over the cap. An approved list with no edits has nothing to send. */
export function decideWapSubmit(input: {
  mayManage: boolean;
  listStatus: WapListStatus;
  totalGranted: number;
  allocatedCount: number;
}): WapDecision {
  if (!input.mayManage) return refuse("not_manager");
  if (input.listStatus !== "draft" && input.listStatus !== "returned") {
    return refuse("list_locked");
  }
  if (input.allocatedCount === 0) return refuse("list_empty");
  if (input.allocatedCount > input.totalGranted) return refuse("over_cap");
  return OK;
}

/** The org approves the whole list. Only a submitted one. */
export function decideWapApprove(listStatus: WapListStatus): WapDecision {
  return listStatus === "submitted" ? OK : refuse("not_submitted_list");
}

/** The org returns the list. Only a submitted one, and only with a note. */
export function decideWapReturn(
  listStatus: WapListStatus,
  note: string | null | undefined,
): WapDecision {
  if (listStatus !== "submitted") return refuse("not_submitted_list");
  if (!note || note.trim() === "") return refuse("note_required");
  return OK;
}

/** The sentence a refused action shows. */
export function wapRefusalMessage(reason: WapRefusal): string {
  switch (reason) {
    case "not_manager":
      return "Only the project's leads can manage its Work Access Passes.";
    case "window_closed":
      return "AfrikaBurn isn't taking Work Access Pass requests right now.";
    case "not_submitted":
      return "Submit the project's registration before asking for passes.";
    case "pending_exists":
      return "You can ask again once AfrikaBurn answers the request that's waiting.";
    case "not_pending":
      return "That request has already been answered.";
    case "grant_too_many":
      return "You can grant fewer passes than asked, never more.";
    case "grant_too_few":
      return "Grant at least one pass, or decline the request.";
    case "no_grant":
      return "AfrikaBurn hasn't granted any passes yet.";
    case "cap_reached":
      return "Every granted pass is already allocated. Ask for more, or take someone off the list.";
    case "not_member":
      return "Only current members of the project can hold a pass.";
    case "already_on_list":
      return "They're already on the list.";
    case "not_on_list":
      return "That pass isn't on the list any more.";
    case "list_locked":
      return "The list is with AfrikaBurn — you can change it once they approve it or send it back.";
    case "list_empty":
      return "Add at least one person before you submit the list.";
    case "over_cap":
      return "The list has more names than passes granted.";
    case "not_submitted_list":
      return "That list isn't waiting for a decision.";
    case "note_required":
      return "Write a note so the project knows what to change.";
    case "dates_out_of_window":
      return "Those dates are too far from the event — check the year and month.";
    case "arrival_after_departure":
      return "Arrival can't be after departure — check the dates.";
  }
}

// --- The pass itself: dates, build, strike --------------------------------

/** The lead's corrections on one pass. Null = use the roster plan. */
export interface WapPassOverrides {
  arrivalDate: string | null;
  departureDate: string | null;
  build: boolean | null;
  strike: boolean | null;
}

export type WapPassField = keyof WapPassOverrides;
export const WAP_PASS_FIELDS: readonly WapPassField[] = [
  "arrivalDate",
  "departureDate",
  "build",
  "strike",
];

export interface EffectiveWapPass {
  arrivalDate: string | null;
  departureDate: string | null;
  /** Null = the member hasn't said and the lead hasn't set it. */
  build: boolean | null;
  strike: boolean | null;
  /** Where the arrival came from. */
  arrivalSource: "pass" | "roster" | "registration" | null;
  /** Fields the lead changed on the pass that the member's own plans say
   * otherwise ("edited"). */
  edited: Record<WapPassField, boolean>;
}

function planValue(
  plan: MemberLogistics | null,
  field: WapPassField,
): string | boolean | null {
  if (!plan) return null;
  switch (field) {
    case "arrivalDate":
      return plan.arrivalDate;
    case "departureDate":
      return plan.departureDate;
    case "build":
      return plan.joiningBuild;
    case "strike":
      return plan.joiningStrike;
  }
}

/**
 * What the pass says. Each field is the lead's override, else the member's
 * roster plan. Arrival falls back once more, to the registration's first
 * arrival date (fewer forms: a sensible default, never an empty cell).
 * `plan` null = the member has no roster plan for this edition.
 */
export function effectiveWapPass(
  overrides: WapPassOverrides,
  plan: MemberLogistics | null,
  registrationFirstArrival: string | null,
): EffectiveWapPass {
  const edited = {} as Record<WapPassField, boolean>;
  for (const f of WAP_PASS_FIELDS) {
    edited[f] = overrides[f] !== null && overrides[f] !== planValue(plan, f);
  }
  let arrivalDate: string | null;
  let arrivalSource: EffectiveWapPass["arrivalSource"];
  if (overrides.arrivalDate !== null) {
    arrivalDate = overrides.arrivalDate;
    arrivalSource = "pass";
  } else if (plan?.arrivalDate) {
    arrivalDate = plan.arrivalDate;
    arrivalSource = "roster";
  } else if (registrationFirstArrival) {
    arrivalDate = registrationFirstArrival;
    arrivalSource = "registration";
  } else {
    arrivalDate = null;
    arrivalSource = null;
  }
  return {
    arrivalDate,
    departureDate: overrides.departureDate ?? plan?.departureDate ?? null,
    build: overrides.build ?? (plan ? plan.joiningBuild : null),
    strike: overrides.strike ?? (plan ? plan.joiningStrike : null),
    arrivalSource,
    edited,
  };
}

/**
 * What to STORE for a lead's edit: an override equal to the member's own plan
 * is stored as null, so the pass keeps following the plan if the member later
 * changes it, and nothing reads as "edited" that isn't.
 */
export function normalizeWapOverrides(
  input: WapPassOverrides,
  plan: MemberLogistics | null,
): WapPassOverrides {
  const out = { ...input };
  for (const f of WAP_PASS_FIELDS) {
    if (out[f] !== null && out[f] === planValue(plan, f)) {
      (out as Record<WapPassField, string | boolean | null>)[f] = null;
    }
  }
  return out;
}

/**
 * Validate a lead's override against the edition (the same window a member's
 * own plan must sit in) and against the dates it will be shown with: an
 * overridden arrival may not land after the roster departure, and vice versa.
 */
export function validateWapOverrides(
  input: WapPassOverrides,
  plan: MemberLogistics | null,
  registrationFirstArrival: string | null,
  edition: { startDate: string; endDate: string },
): WapDecision {
  const window = logisticsWindow(edition);
  for (const d of [input.arrivalDate, input.departureDate]) {
    if (d === null) continue;
    const ms = isoDateToMs(d);
    if (ms === null || !window) return refuse("dates_out_of_window");
    if (d < window.earliest || d > window.latest) {
      return refuse("dates_out_of_window");
    }
  }
  const eff = effectiveWapPass(input, plan, registrationFirstArrival);
  if (
    eff.arrivalDate !== null &&
    eff.departureDate !== null &&
    eff.arrivalDate > eff.departureDate
  ) {
    return refuse("arrival_after_departure");
  }
  return OK;
}

/** "22 Apr", or "—" for no date. */
export function wapDateLabel(iso: string | null): string {
  if (!iso) return "—";
  const l = shiftDateLabel(iso);
  return l.day ? `${l.day} ${l.month}` : iso;
}

/** "Yes" / "No" / "—" for build and strike cells. */
export function wapYesNo(value: boolean | null): string {
  return value === null ? "—" : value ? "Yes" : "No";
}

// --- Flags -----------------------------------------------------------------

export type WapPassFlag =
  | { kind: "bio_incomplete" }
  | { kind: "onboarding_unfinished" }
  | { kind: "other_project"; projectName: string };

/**
 * A pass holder's flags (WAP-007, WAP-015). Flags, never blocks: the org can
 * approve a list with any of them. Incomplete = the bio is not complete
 * (`isBioComplete` — pass `bioComplete: false` when there is no bio row) or a
 * SENT onboarding is unfinished.
 */
export function wapPassFlags(input: {
  bioComplete: boolean;
  onboardingUnfinished: boolean;
  otherProjects: readonly string[];
}): WapPassFlag[] {
  const flags: WapPassFlag[] = [];
  if (!input.bioComplete) flags.push({ kind: "bio_incomplete" });
  if (input.onboardingUnfinished) flags.push({ kind: "onboarding_unfinished" });
  for (const projectName of input.otherProjects) {
    flags.push({ kind: "other_project", projectName });
  }
  return flags;
}

/** Is the holder incomplete (bio or onboarding)? Another pass is not
 * "incomplete" — it is information. */
export function isWapPassIncomplete(flags: readonly WapPassFlag[]): boolean {
  return flags.some(
    (f) => f.kind === "bio_incomplete" || f.kind === "onboarding_unfinished",
  );
}

/** "Bio incomplete" / "Onboarding unfinished" / "Also has a pass from X". */
export function wapFlagLabel(flag: WapPassFlag): string {
  switch (flag.kind) {
    case "bio_incomplete":
      return "Bio incomplete";
    case "onboarding_unfinished":
      return "Onboarding unfinished";
    case "other_project":
      return wapDuplicateNote(flag.projectName);
  }
}

/** The duplicate-holder note. Names the other project — a free camp
 * included (see the header: the narrow, decided exception). */
export function wapDuplicateNote(projectName: string): string {
  return `Also has a pass from ${projectName}`;
}

/** One pass held anywhere in the edition, as the store loads it. */
export interface WapHolding {
  userId: string;
  registrationId: string;
  projectName: string;
}

/**
 * For each person ON THIS LIST, the OTHER projects that also gave them a pass
 * this edition (sorted, de-duplicated). This is the only function that reveals
 * another project's name, and it is scoped by construction:
 *
 *   · only people in `thisListUserIds` get an entry — a holding of someone
 *     not on this list is never surfaced, whatever the caller loaded;
 *   · only the project's NAME leaves; nothing else about it does.
 *
 * The caller must already have decided the viewer manages THIS project (or is
 * the org reviewer with `read` on registrations) — see the header.
 */
export function wapDuplicateHolders(
  thisRegistrationId: string,
  thisListUserIds: readonly string[],
  holdings: readonly WapHolding[],
): Map<string, string[]> {
  const onList = new Set(thisListUserIds);
  const byUser = new Map<string, Set<string>>();
  for (const h of holdings) {
    if (h.registrationId === thisRegistrationId) continue;
    if (!onList.has(h.userId)) continue;
    const set = byUser.get(h.userId) ?? new Set<string>();
    set.add(h.projectName);
    byUser.set(h.userId, set);
  }
  const out = new Map<string, string[]>();
  for (const [userId, names] of byUser) {
    out.set(
      userId,
      [...names].sort((a, b) => a.localeCompare(b)),
    );
  }
  return out;
}

// --- Since approval --------------------------------------------------------

/** One pass as it stands now (effective values). */
export interface WapCurrentPass {
  membershipId: string;
  userId: string;
  arrivalDate: string | null;
  departureDate: string | null;
  build: boolean | null;
  strike: boolean | null;
}

/** The snapshot entry an approval stores for one pass. */
export function wapApprovedPass(pass: WapCurrentPass): WapApprovedPass {
  return {
    membershipId: pass.membershipId,
    userId: pass.userId,
    arrivalDate: pass.arrivalDate,
    departureDate: pass.departureDate,
    build: pass.build,
    strike: pass.strike,
  };
}

export interface WapFieldChange {
  membershipId: string;
  userId: string;
  field: WapPassField;
  from: string | boolean | null;
  to: string | boolean | null;
}

export interface WapChangesSinceApproval {
  /** False when the list has never been approved — nothing to compare. */
  everApproved: boolean;
  added: WapCurrentPass[];
  removed: WapApprovedPass[];
  changed: WapFieldChange[];
  any: boolean;
}

/**
 * What changed between the list as approved and the list now. People are
 * matched by MEMBERSHIP (a member who left and rejoined is a new membership,
 * and correctly reads as removed + added).
 */
export function wapChangesSinceApproval(
  snapshot: readonly WapApprovedPass[] | null,
  current: readonly WapCurrentPass[],
): WapChangesSinceApproval {
  if (!snapshot) {
    return {
      everApproved: false,
      added: [],
      removed: [],
      changed: [],
      any: false,
    };
  }
  const before = new Map(snapshot.map((p) => [p.membershipId, p]));
  const now = new Map(current.map((p) => [p.membershipId, p]));
  const added = current.filter((p) => !before.has(p.membershipId));
  const removed = snapshot.filter((p) => !now.has(p.membershipId));
  const changed: WapFieldChange[] = [];
  for (const p of current) {
    const b = before.get(p.membershipId);
    if (!b) continue;
    for (const f of WAP_PASS_FIELDS) {
      if (b[f] !== p[f]) {
        changed.push({
          membershipId: p.membershipId,
          userId: p.userId,
          field: f,
          from: b[f],
          to: p[f],
        });
      }
    }
  }
  return {
    everApproved: true,
    added,
    removed,
    changed,
    any: added.length + removed.length + changed.length > 0,
  };
}

const FIELD_WORD: Record<WapPassField, string> = {
  arrivalDate: "arrival",
  departureDate: "departure",
  build: "build",
  strike: "strike",
};

function changeValue(field: WapPassField, v: string | boolean | null): string {
  if (field === "build" || field === "strike") {
    return wapYesNo(typeof v === "boolean" ? v : null);
  }
  return wapDateLabel(typeof v === "string" ? v : null);
}

/** "strike No → Yes", "arrival 22 Apr → 24 Apr". */
export function wapChangeLabel(change: WapFieldChange): string {
  return `${FIELD_WORD[change.field]} ${changeValue(change.field, change.from)} → ${changeValue(change.field, change.to)}`;
}

/** "1 removed since approval" / "3 removed since approval". */
export function wapRemovedSinceApprovalLabel(count: number): string {
  return `${count} removed since approval`;
}

/**
 * The badge next to the list status, or null.
 *
 *   · An APPROVED list that lost names (a member left or was archived) stays
 *     approved and says "N removed since approval".
 *   · A list approved before and changed since (now draft, submitted or
 *     returned) says "Changed since approval".
 */
export function wapSinceApprovalBadge(
  status: WapListStatus,
  changes: WapChangesSinceApproval,
): string | null {
  if (!changes.everApproved) return null;
  if (status === "approved") {
    return changes.removed.length > 0
      ? wapRemovedSinceApprovalLabel(changes.removed.length)
      : null;
  }
  return changes.any ? "Changed since approval" : null;
}

// --- Summaries -------------------------------------------------------------

/** "7 of 10 allocated". */
export function wapAllocatedLabel(allocated: number, granted: number): string {
  return `${allocated} of ${granted} allocated`;
}

/** "3 passes left" / "1 pass left" / "No passes left". */
export function wapPassesLeftLabel(allocated: number, granted: number): string {
  const left = Math.max(0, granted - allocated);
  if (left === 0) return "No passes left";
  return `${left} pass${left === 1 ? "" : "es"} left`;
}

export const WAP_LIST_STATUS_LABELS: Record<WapListStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned",
};

/** Lead-side wording ("Waiting" — the org hasn't answered). */
export const WAP_REQUEST_STATUS_LABELS: Record<WapRequestStatus, string> = {
  pending: "Waiting",
  granted: "Granted",
  declined: "Declined",
};

/** One project's row on the org overview (W3). */
export interface WapProjectFacts {
  registrationId: string;
  projectName: string;
  groupKind: GroupKind;
  listStatus: WapListStatus;
  requests: readonly Pick<
    WapRequestFacts,
    "requested" | "status" | "granted"
  >[];
  allocated: number;
}

export interface WapProjectSummary {
  registrationId: string;
  projectName: string;
  groupKind: GroupKind;
  listStatus: WapListStatus;
  requested: number;
  granted: number;
  allocated: number;
  /** Passes asked in the pending request, or null. */
  pendingAsk: number | null;
}

export function summariseWapProject(p: WapProjectFacts): WapProjectSummary {
  const pending = pendingWapRequest(p.requests);
  return {
    registrationId: p.registrationId,
    projectName: p.projectName,
    groupKind: p.groupKind,
    listStatus: p.listStatus,
    requested: totalWapRequested(p.requests),
    granted: totalWapGranted(p.requests),
    allocated: p.allocated,
    pendingAsk: pending ? pending.requested : null,
  };
}

export interface WapOverviewTotals {
  requested: number;
  granted: number;
  allocated: number;
  /** Projects with at least one granted pass. */
  projectsGranted: number;
  pendingRequests: number;
  pendingPasses: number;
}

export function wapOverviewTotals(
  rows: readonly WapProjectSummary[],
): WapOverviewTotals {
  const t: WapOverviewTotals = {
    requested: 0,
    granted: 0,
    allocated: 0,
    projectsGranted: 0,
    pendingRequests: 0,
    pendingPasses: 0,
  };
  for (const r of rows) {
    t.requested += r.requested;
    t.granted += r.granted;
    t.allocated += r.allocated;
    if (r.granted > 0) t.projectsGranted += 1;
    if (r.pendingAsk !== null) {
      t.pendingRequests += 1;
      t.pendingPasses += r.pendingAsk;
    }
  }
  return t;
}

export interface WapOverviewFilter {
  status: WapListStatus | null;
  kind: GroupKind | null;
  pendingOnly: boolean;
}

export function filterWapOverview(
  rows: readonly WapProjectSummary[],
  filter: WapOverviewFilter,
): WapProjectSummary[] {
  return rows.filter(
    (r) =>
      (filter.status === null || r.listStatus === filter.status) &&
      (filter.kind === null || r.groupKind === filter.kind) &&
      (!filter.pendingOnly || r.pendingAsk !== null),
  );
}

// --- Notifications ---------------------------------------------------------
// Kind `wap`, in-app only (`shouldSendImmediateEmail("wap")` is false — no
// email until Resend exists). Titles carry project names and numbers only;
// the project's name is the body so a lead of two projects knows which.

/** The base path a project's own pages live under, by kind. */
export function wapProjectBasePath(kind: GroupKind, slug: string): string {
  const base =
    kind === "artwork"
      ? "/artworks"
      : kind === "mutant_vehicle"
        ? "/vehicles"
        : "/camps";
  return `${base}/${slug}`;
}

/** The lead's Passes page. */
export function wapPassesPath(kind: GroupKind, slug: string): string {
  return `${wapProjectBasePath(kind, slug)}/passes`;
}

/** The project's own page, where a member sees their pass. `/camps/<slug>` is
 * every group's dashboard — `/artworks/<slug>` and `/vehicles/<slug>` hold only
 * sub-pages (edit, questionnaires, passes) and have no page of their own. */
export function wapProjectPagePath(slug: string): string {
  return `/camps/${slug}`;
}

export interface WapNoticeContext {
  projectName: string;
  projectKind: GroupKind;
  projectSlug: string;
}

function wapNotice(
  c: WapNoticeContext,
  title: string,
  link: string = wapPassesPath(c.projectKind, c.projectSlug),
): NotificationPayload {
  return { kind: "wap", title, body: c.projectName, link };
}

/** To every lead and co-lead with a submitted registration. */
export function wapRequestsOpenNotification(
  c: WapNoticeContext,
  editionName: string,
): NotificationPayload {
  return wapNotice(
    c,
    `${editionName}: Work Access Pass requests are open — ask for the passes the project needs`,
  );
}

/** To leads and co-leads: the org granted a request. */
export function wapRequestGrantedNotification(
  c: WapNoticeContext,
  granted: number,
  requested: number,
): NotificationPayload {
  const passes = `${granted} Work Access Pass${granted === 1 ? "" : "es"}`;
  return wapNotice(
    c,
    granted < requested
      ? `AfrikaBurn granted ${passes} (you asked for ${requested})`
      : `AfrikaBurn granted ${passes}`,
  );
}

/** To leads and co-leads: the org declined a request. */
export function wapRequestDeclinedNotification(
  c: WapNoticeContext,
  requested: number,
): NotificationPayload {
  return wapNotice(
    c,
    `AfrikaBurn declined the request for ${requested} Work Access Pass${requested === 1 ? "" : "es"}`,
  );
}

/** To leads and co-leads: the list was approved. */
export function wapListApprovedNotification(
  c: WapNoticeContext,
): NotificationPayload {
  return wapNotice(c, "AfrikaBurn approved the Work Access Pass list");
}

/** To leads and co-leads: the list was returned, with the org's note. */
export function wapListReturnedNotification(
  c: WapNoticeContext,
  note: string,
): NotificationPayload {
  return {
    ...wapNotice(c, "AfrikaBurn sent the Work Access Pass list back"),
    body: `${c.projectName}: ${note.trim()}`,
  };
}

/** To each pass holder when their project's list is approved. Links to the
 * project page, where the member sees their own pass. */
export function wapPassApprovedNotification(
  c: WapNoticeContext,
): NotificationPayload {
  return wapNotice(
    c,
    "You have a Work Access Pass — AfrikaBurn approved the list",
    wapProjectPagePath(c.projectSlug),
  );
}

/**
 * The member's own pass line on the project page, or null when there is
 * nothing to show (not on the list, or the list is a draft — a draft is the
 * lead's working copy, not a promise).
 */
export function wapOwnPassLine(
  listStatus: WapListStatus | null,
  onList: boolean,
): string | null {
  if (!onList || listStatus === null || listStatus === "draft") return null;
  switch (listStatus) {
    case "approved":
      return "You have a Work Access Pass — approved by AfrikaBurn";
    case "submitted":
      return "You have a Work Access Pass — waiting for AfrikaBurn to approve the list";
    case "returned":
      return "You have a Work Access Pass — the list is being updated";
  }
}

// --- CSV export (WAP-009) ---------------------------------------------------

/**
 * One exported pass. THE WHOLE POINT OF THIS TYPE IS WHAT IT LACKS: no phone,
 * no emergency contact, no ID or passport number, no medical note. Email IS
 * here — it is why the export needs `personal_information` — because it is
 * how AfrikaBurn matches a pass to a person. A test pins that no key or header
 * names an always-private field.
 */
export interface WapExportRow {
  project: string;
  projectType: string;
  listStatus: string;
  name: string;
  username: string | null;
  email: string | null;
  arrival: string | null;
  departure: string | null;
  build: boolean | null;
  strike: boolean | null;
  flags: string;
}

export const WAP_EXPORT_COLUMNS: readonly {
  key: keyof WapExportRow;
  header: string;
}[] = [
  { key: "project", header: "Project" },
  { key: "projectType", header: "Project type" },
  { key: "listStatus", header: "List status" },
  { key: "name", header: "Name" },
  { key: "username", header: "Username" },
  { key: "email", header: "Email" },
  { key: "arrival", header: "Arrival" },
  { key: "departure", header: "Departure" },
  { key: "build", header: "Build" },
  { key: "strike", header: "Strike" },
  { key: "flags", header: "Flags" },
];

const PROJECT_TYPE_LABELS: Partial<Record<GroupKind, string>> = {
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

/** The input one export row is projected from. */
export interface WapExportInput {
  projectName: string;
  projectKind: GroupKind;
  listStatus: WapListStatus;
  name: string;
  username: string | null;
  email: string | null;
  pass: Pick<
    EffectiveWapPass,
    "arrivalDate" | "departureDate" | "build" | "strike"
  >;
  flags: readonly WapPassFlag[];
}

/** The export projection. Field-by-field: whatever a caller passes in, the
 * output has exactly the `WapExportRow` keys. */
export function wapExportRow(input: WapExportInput): WapExportRow {
  return {
    project: input.projectName,
    projectType: PROJECT_TYPE_LABELS[input.projectKind] ?? input.projectKind,
    listStatus: WAP_LIST_STATUS_LABELS[input.listStatus],
    name: input.name,
    username: input.username,
    email: input.email,
    arrival: input.pass.arrivalDate,
    departure: input.pass.departureDate,
    build: input.pass.build,
    strike: input.pass.strike,
    flags: input.flags.map(wapFlagLabel).join("; "),
  };
}

/** CSV text: UTF-8 BOM, CRLF, every cell through `escapeCsvField` (formula
 * injection — names are typed by the public). */
export function buildWapCsv(rows: readonly WapExportInput[]): string {
  const lines = [
    WAP_EXPORT_COLUMNS.map((c) => escapeCsvField(c.header)).join(","),
    ...rows.map((r) => {
      const out = wapExportRow(r);
      return WAP_EXPORT_COLUMNS.map((c) => escapeCsvField(out[c.key])).join(
        ",",
      );
    }),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** `afrikaburn-2027-work-access-passes-2027-03-01.csv`. */
export function wapCsvFilename(year: number, today: Date): string {
  return `afrikaburn-${year}-work-access-passes-${today.toISOString().slice(0, 10)}.csv`;
}

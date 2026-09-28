// Camp roster operations (epic #55 — App Spec §4 CDB-011..014, CDB-030..033,
// §5 STATS-017..019, STATS-022). PURE predicates, filters, aggregates,
// validation and CSV serialisation — no DB, no I/O. The apps load memberships,
// bios and logistics, pass them here, and render ONLY what comes back.
//
// Decision 007 is open (camp-planning tools may move to another app), which is
// why every decision lives here and the web app holds a thin loader only.
//
// ── WHO SEES THE ROSTER ─────────────────────────────────────────────────────
//
// The roster — search, filter, stats, logistics columns, export — is served to
// a member of THIS project who holds the `view_member_details` project
// permission. Structural lead/admin hold it irrevocably (./project-permissions
// backstop); a plain member holds it only through a role that grants it. A
// non-member, or a member without the permission, is refused with the same
// outcome as a camp that does not exist — the caller renders the refusal as a
// not-found, so a free camp stays undiscoverable. A lead of camp A holds no
// membership of camp B, so their permission there is `null` and they get
// nothing: the caller loads the viewer's permission membership OF THE GROUP
// BEING ASKED ABOUT, and a missing one is a refusal.
//
// ── WHAT A ROSTER ROW CAN CARRY ─────────────────────────────────────────────
//
// A LIST shape. `CampRosterRow` has no slot for any hard-locked field (phone,
// emergency contacts, SA ID, passport) or for medical notes, so neither the
// page nor the export can render one however the loader is wired: lists never
// carry them (./privacy module header). Bio COMPLETION is on the row; the bio's
// contents are not.
//
// ── LOGISTICS ARE SELF-OWNED ────────────────────────────────────────────────
//
// Build, strike, arrival and departure are set ONLY by the member themselves
// (Decision 008 keeps records self-owned — no lead edits another person's
// record). They are visible to the member and to this project's roster
// viewers; never public, never to camp-mates generally.
//
// ── STATS ARE AGGREGATES ────────────────────────────────────────────────────
//
// `CampRosterStats` is numbers only. There is no per-person breakdown on it and
// there must never be one: a "who is new" list is the roster filter's job, and
// it sits behind the same permission as the roster itself.

import { z } from "zod";
import type { GroupKind, MembershipRole } from "@quagga/types";
import {
  hasProjectPermission,
  type PermissionMembership,
} from "./project-permissions";
import type { OutstandingOfficers } from "./officers";
import { CSV_BOM, escapeCsvField } from "./registration-export";

/** The group kinds that have a roster. Every project kind — never the org
 * group, whose people are AfrikaBurn staff and are managed in the console. */
export const ROSTER_GROUP_KINDS: readonly GroupKind[] = [
  "theme_camp",
  "artwork",
  "mutant_vehicle",
];

function isRosterGroupKind(kind: GroupKind): boolean {
  return ROSTER_GROUP_KINDS.includes(kind);
}

// --- Authorisation --------------------------------------------------------

/** The facts a roster decision needs. `viewerMembership` is the viewer's
 * permission membership OF THIS GROUP, loaded server-side (null ⇒ not a
 * member). */
export interface RosterAccessContext {
  groupKind: GroupKind;
  viewerMembership: PermissionMembership | null;
}

/**
 * May the viewer open this project's roster (search, filter, stats and the
 * logistics columns)? A member holding `view_member_details` — lead/admin
 * always. Fail-closed: no membership ⇒ false; the org group ⇒ false.
 */
export function canViewCampRoster(ctx: RosterAccessContext): boolean {
  if (!isRosterGroupKind(ctx.groupKind)) return false;
  if (!ctx.viewerMembership) return false;
  return hasProjectPermission(ctx.viewerMembership, "view_member_details");
}

/**
 * May the viewer download the roster as CSV? The same reader taking the same
 * rows away with them — exporting is not a new permission (the org's placement
 * export reasons the same way). A separate name so the two can diverge on
 * purpose, never by accident.
 */
export function canExportCampRoster(ctx: RosterAccessContext): boolean {
  return canViewCampRoster(ctx);
}

/** A membership as the self-edit predicate needs it. */
export interface LogisticsMembership {
  userId: string;
  groupKind: GroupKind;
}

/**
 * May the viewer edit the logistics on this membership? Only their OWN, and
 * only on a project membership. No permission, role or seniority widens this:
 * a lead holds `view_member_details`, which is a READ grant, and the records
 * are self-owned (Decision 008).
 */
export function canEditOwnLogistics(input: {
  viewerUserId: string;
  membership: LogisticsMembership | null;
}): boolean {
  if (!input.membership) return false;
  if (!isRosterGroupKind(input.membership.groupKind)) return false;
  return input.membership.userId === input.viewerUserId;
}

/**
 * May the viewer see the subject's logistics? The subject themselves, or a
 * roster viewer of the SAME group. `subjectInGroup` is required rather than
 * assumed so a loader that handed over someone else's row cannot widen it.
 */
export function canViewMemberLogistics(input: {
  viewerUserId: string;
  subjectUserId: string;
  subjectInGroup: boolean;
  access: RosterAccessContext;
}): boolean {
  if (!input.subjectInGroup) return false;
  if (!isRosterGroupKind(input.access.groupKind)) return false;
  if (input.viewerUserId === input.subjectUserId) return true;
  return canViewCampRoster(input.access);
}

// --- Logistics ------------------------------------------------------------

/** One member's plans for one edition, as stored and as shown. Dates are ISO
 * `YYYY-MM-DD` calendar dates (no time, no zone), or null when not yet known. */
export interface MemberLogistics {
  joiningBuild: boolean;
  joiningStrike: boolean;
  arrivalDate: string | null;
  departureDate: string | null;
}

/** Nothing planned yet — what an unset card shows. */
export function emptyMemberLogistics(): MemberLogistics {
  return {
    joiningBuild: false,
    joiningStrike: false,
    arrivalDate: null,
    departureDate: null,
  };
}

/** How far either side of the event a date may sit. Build week starts well
 * before the gates open and strike runs on after they close; anything outside
 * this is a typo (the wrong year, a swapped month), not a plan. */
export const LOGISTICS_DAYS_BEFORE_START = 30;
export const LOGISTICS_DAYS_AFTER_END = 14;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a `YYYY-MM-DD` calendar date to UTC midnight ms, or null when it is
 * not one (including 2027-02-30, which `Date` would silently roll over). */
function parseIsoDate(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `2027-04-26` → `26 April 2027`. Hand-rolled so the message reads the same
 * on every server whatever its locale data. Assumes a valid ISO date. */
export function formatLogisticsDate(iso: string): string {
  const ms = parseIsoDate(iso);
  if (ms === null) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The earliest and latest dates a member may give for this edition. */
export function logisticsWindow(edition: {
  startDate: string;
  endDate: string;
}): { earliest: string; latest: string } | null {
  const start = parseIsoDate(edition.startDate);
  const end = parseIsoDate(edition.endDate);
  if (start === null || end === null) return null;
  return {
    earliest: isoFromMs(start - LOGISTICS_DAYS_BEFORE_START * DAY_MS),
    latest: isoFromMs(end + LOGISTICS_DAYS_AFTER_END * DAY_MS),
  };
}

/** A calendar date field: `YYYY-MM-DD`, or empty/null for "not known yet". */
const LogisticsDate = z
  .union([z.string().trim().max(10), z.null()])
  .transform((v) => (v === null || v === "" ? null : v));

/** The wire shape of a logistics save. STRICT: a request naming a membership
 * or a user is refused outright rather than having the key quietly dropped —
 * whose record this is comes from the session, never from the body. */
export const MemberLogisticsInput = z
  .object({
    joiningBuild: z.boolean(),
    joiningStrike: z.boolean(),
    arrivalDate: LogisticsDate,
    departureDate: LogisticsDate,
  })
  .strict();

export type LogisticsValidation =
  { ok: true; value: MemberLogistics } | { ok: false; error: string };

/**
 * Validate a logistics save against the edition's dates. Returns the value to
 * store, or a message a member can act on:
 *
 *   · each date must be a real calendar date;
 *   · each must sit inside `logisticsWindow` (30 days before the gates open to
 *     14 after they close);
 *   · arrival must not be after departure (the same day is a day trip, fine).
 */
export function validateMemberLogistics(
  raw: unknown,
  edition: { startDate: string; endDate: string },
): LogisticsValidation {
  const parsed = MemberLogisticsInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That didn't look like a travel plan." };
  }
  const value = parsed.data;
  const window = logisticsWindow(edition);
  if (!window) {
    return { ok: false, error: "This edition's dates aren't set yet." };
  }
  const earliest = parseIsoDate(window.earliest)!;
  const latest = parseIsoDate(window.latest)!;
  const range = `${formatLogisticsDate(window.earliest)} and ${formatLogisticsDate(window.latest)}`;

  const dates: Array<[label: string, value: string | null]> = [
    ["arrival", value.arrivalDate],
    ["departure", value.departureDate],
  ];
  const ms: Record<string, number | null> = {};
  for (const [label, date] of dates) {
    if (date === null) {
      ms[label] = null;
      continue;
    }
    const parsedDate = parseIsoDate(date);
    if (parsedDate === null) {
      return {
        ok: false,
        error: `Your ${label} date isn't a real date — use the date picker.`,
      };
    }
    if (parsedDate < earliest || parsedDate > latest) {
      return {
        ok: false,
        error: `Your ${label} date needs to be between ${range}.`,
      };
    }
    ms[label] = parsedDate;
  }
  if (ms.arrival != null && ms.departure != null && ms.arrival > ms.departure) {
    return {
      ok: false,
      error: "You can't leave before you arrive — check your dates.",
    };
  }
  return { ok: true, value };
}

// --- Roster rows ----------------------------------------------------------

/** Where a member's bio stands THIS edition. */
export type RosterBioStatus = "complete" | "incomplete" | "none";

/** `none` — no bio row this edition; `incomplete` — a row not yet confirmed;
 * `complete` — confirmed (`completed_at` set). */
export function rosterBioStatus(
  bio: { completedAt: Date | null } | null,
): RosterBioStatus {
  if (!bio) return "none";
  return bio.completedAt != null ? "complete" : "incomplete";
}

/** A project role a member holds (accepted, never the derived baseline). */
export interface RosterProjectRole {
  id: string;
  name: string;
}

/**
 * A member as the roster loader hands them over. Deliberately narrow: the
 * loader selects nothing it could not put here, and this has no slot for a
 * phone, an emergency contact, an ID number or a medical note.
 */
export interface RosterMemberInput {
  membershipId: string;
  userId: string;
  /** The name the camp page's roster already shows (`publicMemberName`). */
  displayName: string;
  /** The account's burner name; null on a departed account. */
  username: string | null;
  structuralRole: MembershipRole;
  projectRoles: readonly RosterProjectRole[];
  /** This edition's bio, trimmed to what completion and the new/returning
   * split need — or null when there is none this edition. */
  bio: { completedAt: Date | null; firstTime: boolean } | null;
  /** This edition's logistics, or null when the member has set none. */
  logistics: MemberLogistics | null;
}

/** One roster row, as the page and the export read it. */
export interface CampRosterRow {
  membershipId: string;
  userId: string;
  displayName: string;
  username: string | null;
  structuralRole: MembershipRole;
  projectRoles: RosterProjectRole[];
  bioStatus: RosterBioStatus;
  logistics: MemberLogistics | null;
}

/** Project a loader row onto the roster shape — field by field, so an extra
 * property on the input (a loader that selected too much) never rides along. */
export function toCampRosterRow(member: RosterMemberInput): CampRosterRow {
  return {
    membershipId: member.membershipId,
    userId: member.userId,
    displayName: member.displayName,
    username: member.username,
    structuralRole: member.structuralRole,
    projectRoles: member.projectRoles.map((r) => ({ id: r.id, name: r.name })),
    bioStatus: rosterBioStatus(member.bio),
    logistics: member.logistics
      ? {
          joiningBuild: member.logistics.joiningBuild,
          joiningStrike: member.logistics.joiningStrike,
          arrivalDate: member.logistics.arrivalDate,
          departureDate: member.logistics.departureDate,
        }
      : null,
  };
}

// --- Filter (URL search params → filter → rows) ----------------------------

/** Structural roles the role filter offers. Org ranks in a camp are
 * exceptional and are not a filter a camp needs. */
export const ROSTER_STRUCTURAL_FILTERS = ["lead", "admin", "member"] as const;
export type RosterStructuralFilter = (typeof ROSTER_STRUCTURAL_FILTERS)[number];

export const ROSTER_BIO_FILTERS = ["complete", "incomplete"] as const;
export type RosterBioFilter = (typeof ROSTER_BIO_FILTERS)[number];

/** Which people the roster lists: the camp (default), or its FORMER members
 * (CDB-036 — archived memberships, kept as history). Not a narrowing of the
 * same list: the loader reads a different set of rows for each, so a former
 * member can never appear on the current roster however a filter is set. */
export const ROSTER_STATUS_FILTERS = ["current", "former"] as const;
export type RosterStatusFilter = (typeof ROSTER_STATUS_FILTERS)[number];

/** Longest search a query param may carry. */
export const ROSTER_QUERY_MAX = 100;

/** The prefix that marks a project-role id in the `role` param. */
const PROJECT_ROLE_PREFIX = "role:";

export type RosterRoleFilter =
  | { kind: "structural"; role: RosterStructuralFilter }
  | { kind: "project"; roleId: string };

export interface RosterFilter {
  /** Normalised search text; empty ⇒ no search. */
  q: string;
  role: RosterRoleFilter | null;
  bio: RosterBioFilter | null;
  /** Current members (default) or former members. */
  status: RosterStatusFilter;
}

export function emptyRosterFilter(): RosterFilter {
  return { q: "", role: null, bio: null, status: "current" };
}

/** Lower-case, strip accents, collapse whitespace — so "Zoë" finds "zoe". */
export function normalizeRosterSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type SearchParamValue = string | readonly string[] | undefined;

function firstParam(value: SearchParamValue): string | undefined {
  if (typeof value === "string") return value;
  return value?.[0];
}

/**
 * Read the roster filter from URL search params. Fail-SOFT: an unknown role,
 * a project role that is not this camp's, or a bio value outside the
 * vocabulary is ignored rather than refused — a stale bookmark shows the whole
 * roster, not an error. `projectRoleIds` is this camp's role ids, so a role id
 * from another camp filters nothing.
 */
export function parseRosterFilter(
  params: Readonly<Record<string, SearchParamValue>>,
  projectRoleIds: ReadonlySet<string>,
): RosterFilter {
  const filter = emptyRosterFilter();

  const q = firstParam(params.q);
  if (q) filter.q = normalizeRosterSearch(q.slice(0, ROSTER_QUERY_MAX));

  const role = firstParam(params.role);
  if (role) {
    if ((ROSTER_STRUCTURAL_FILTERS as readonly string[]).includes(role)) {
      filter.role = {
        kind: "structural",
        role: role as RosterStructuralFilter,
      };
    } else if (role.startsWith(PROJECT_ROLE_PREFIX)) {
      const roleId = role.slice(PROJECT_ROLE_PREFIX.length);
      if (projectRoleIds.has(roleId)) {
        filter.role = { kind: "project", roleId };
      }
    }
  }

  const bio = firstParam(params.bio);
  if (bio && (ROSTER_BIO_FILTERS as readonly string[]).includes(bio)) {
    filter.bio = bio as RosterBioFilter;
  }

  // Anything but the one other value reads as the camp itself.
  if (firstParam(params.status) === "former") filter.status = "former";
  return filter;
}

/** The `role` param value for a role filter (inverse of the parse). */
export function rosterRoleParam(role: RosterRoleFilter): string {
  return role.kind === "structural"
    ? role.role
    : `${PROJECT_ROLE_PREFIX}${role.roleId}`;
}

/** The filter as a query string (no leading `?`; empty when unfiltered), so
 * the page, its links and the export all say the same thing. */
export function rosterFilterQuery(filter: RosterFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.role) params.set("role", rosterRoleParam(filter.role));
  if (filter.bio) params.set("bio", filter.bio);
  if (filter.status === "former") params.set("status", "former");
  return params.toString();
}

/** Is any NARROWING filter applied? `status` is not one: it picks which list
 * is shown, and "Showing n of m" is counted within that list. */
export function isRosterFiltered(filter: RosterFilter): boolean {
  return filter.q !== "" || filter.role !== null || filter.bio !== null;
}

function matchesFilter(row: CampRosterRow, filter: RosterFilter): boolean {
  if (filter.q) {
    const haystack = normalizeRosterSearch(
      `${row.displayName} ${row.username ?? ""}`,
    );
    if (!haystack.includes(filter.q)) return false;
  }
  if (filter.role) {
    if (filter.role.kind === "structural") {
      if (row.structuralRole !== filter.role.role) return false;
    } else {
      const roleId = filter.role.roleId;
      if (!row.projectRoles.some((r) => r.id === roleId)) return false;
    }
  }
  if (filter.bio === "complete" && row.bioStatus !== "complete") return false;
  if (filter.bio === "incomplete" && row.bioStatus === "complete") return false;
  return true;
}

/** Display order: seniority, then name. Org ranks first because an org
 * account in a camp is exceptional enough to want at the top (the camp page
 * sorts the same way). */
const ROLE_RANK: Record<MembershipRole, number> = {
  god: 0,
  org_staff: 1,
  engineer: 2,
  lead: 3,
  admin: 4,
  member: 5,
};

function compareRows(a: CampRosterRow, b: CampRosterRow): number {
  const byRole = ROLE_RANK[a.structuralRole] - ROLE_RANK[b.structuralRole];
  if (byRole !== 0) return byRole;
  return a.displayName.localeCompare(b.displayName);
}

export interface CampRosterView {
  /** The rows the filter kept, in display order. */
  rows: CampRosterRow[];
  /** Everyone on the roster before filtering. */
  total: number;
}

/**
 * Build the roster for a viewer, or `null` (refused) unless they may view it.
 * The refusal comes first, so a caller that forgot its own check still gets
 * nothing back.
 */
export function buildCampRoster(input: {
  access: RosterAccessContext;
  members: readonly RosterMemberInput[];
  filter: RosterFilter;
}): CampRosterView | null {
  if (!canViewCampRoster(input.access)) return null;
  const all = input.members.map(toCampRosterRow);
  const rows = all
    .filter((row) => matchesFilter(row, input.filter))
    .sort(compareRows);
  return { rows, total: all.length };
}

// --- Stats (aggregates only) ----------------------------------------------

/** The camp stats card. NUMBERS ONLY — see the module header. */
export interface CampRosterStats {
  total: number;
  /** First burn, per their bio's first-time flag (STATS-018). */
  newcomers: number;
  /** Has a bio this edition and is not a first-timer (STATS-019). */
  returning: number;
  /** No bio this edition, so neither new nor returning is known. */
  unknown: number;
  /** Bios confirmed this edition (STATS-022). */
  biosComplete: number;
  /** Members who said they are joining build / strike (STATS-024, -025). */
  joiningBuild: number;
  joiningStrike: number;
  /** Former members — archived memberships kept as history (CDB-036). A
   * count only, like everything else on the card. */
  former: number;
  officers: {
    /** False for a camp whose registration is not approved or in flight —
     * requirements do not apply yet (./officers `outstandingOfficers`). */
    applies: boolean;
    filled: number;
    required: number;
  };
}

/**
 * Aggregate the roster. Takes the UNFILTERED members: the card describes the
 * camp, not the current search. Officer figures come straight from the
 * officer status the settings page already derives, so the two never
 * disagree.
 *
 * New/returning read the first-time flag of this edition's bio row whether or
 * not it is confirmed — the flag is a fact about the person, not a privacy
 * choice, and it never leaves this function except as a count.
 */
export function deriveCampRosterStats(
  members: readonly Pick<RosterMemberInput, "bio" | "logistics">[],
  officers: OutstandingOfficers | null,
  formerCount = 0,
): CampRosterStats {
  let newcomers = 0;
  let returning = 0;
  let unknown = 0;
  let biosComplete = 0;
  let joiningBuild = 0;
  let joiningStrike = 0;
  for (const m of members) {
    if (m.logistics?.joiningBuild) joiningBuild += 1;
    if (m.logistics?.joiningStrike) joiningStrike += 1;
    if (!m.bio) {
      unknown += 1;
      continue;
    }
    if (m.bio.firstTime) newcomers += 1;
    else returning += 1;
    if (m.bio.completedAt != null) biosComplete += 1;
  }
  return {
    total: members.length,
    newcomers,
    returning,
    unknown,
    biosComplete,
    joiningBuild,
    joiningStrike,
    former: formerCount,
    officers: officers?.applies
      ? {
          applies: true,
          filled: officers.assignedCount,
          required: officers.requiredCount,
        }
      : { applies: false, filled: 0, required: 0 },
  };
}

// --- Export (CSV) ---------------------------------------------------------

/** Labels for the structural ladder, as the camp page shows them. `god` is
 * "System manager" — the stored value stays `god` on purpose. */
export const ROSTER_ROLE_LABEL: Record<MembershipRole, string> = {
  god: "System manager",
  org_staff: "Org staff",
  engineer: "Engineer",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

/**
 * One exported row. THE WHOLE POINT OF THIS TYPE IS WHAT IT LACKS: no phone,
 * no emergency contact, no ID or passport number, no medical note, no email.
 * A roster spreadsheet gets mailed around and left in downloads folders; it is
 * the worst container for any of those, and a lead planning build week needs
 * none of them. A test pins that no key here names an always-private field.
 */
export interface RosterExportRow {
  name: string;
  burnerName: string | null;
  roles: string;
  arrival: string | null;
  departure: string | null;
  build: boolean | null;
  strike: boolean | null;
}

/** The export's columns, in order. */
export const ROSTER_EXPORT_COLUMNS: readonly {
  key: keyof RosterExportRow;
  header: string;
}[] = [
  { key: "name", header: "Name" },
  { key: "burnerName", header: "Burner name" },
  { key: "roles", header: "Roles" },
  { key: "arrival", header: "Arrival" },
  { key: "departure", header: "Departure" },
  { key: "build", header: "Joining build" },
  { key: "strike", header: "Joining strike" },
];

/**
 * The export projection. PURE and field-by-field: it reads the named fields
 * off a roster row and nothing else, so whatever a caller passes in, the
 * output has exactly the `RosterExportRow` keys. No logistics ⇒ blank cells
 * (not "No" — "hasn't said" is not "isn't coming").
 */
export function rosterExportRow(row: CampRosterRow): RosterExportRow {
  const roles = [
    ROSTER_ROLE_LABEL[row.structuralRole],
    ...row.projectRoles.map((r) => r.name),
  ].join("; ");
  return {
    name: row.displayName,
    burnerName: row.username,
    roles,
    arrival: row.logistics?.arrivalDate ?? null,
    departure: row.logistics?.departureDate ?? null,
    build: row.logistics ? row.logistics.joiningBuild : null,
    strike: row.logistics ? row.logistics.joiningStrike : null,
  };
}

/**
 * Render roster rows as CSV text: UTF-8 BOM and CRLF for Excel, and every
 * cell through `escapeCsvField`, which neutralises a leading `=`, `+`, `-`,
 * `@`, tab or carriage return — a burner name is typed by the public, and
 * `=HYPERLINK(...)` must arrive as text, never as a formula.
 */
export function buildRosterCsv(rows: readonly CampRosterRow[]): string {
  const lines = [
    ROSTER_EXPORT_COLUMNS.map((c) => escapeCsvField(c.header)).join(","),
    ...rows.map((row) => {
      const out = rosterExportRow(row);
      return ROSTER_EXPORT_COLUMNS.map((c) => escapeCsvField(out[c.key])).join(
        ",",
      );
    }),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** `mad-hatters-2027-roster-2027-03-01.csv`. The slug is re-sanitised so a
 * header can never be broken by it. */
export function rosterCsvFilename(
  slug: string,
  year: number,
  today: Date,
): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  return `${safe || "camp"}-${year}-roster-${today.toISOString().slice(0, 10)}.csv`;
}

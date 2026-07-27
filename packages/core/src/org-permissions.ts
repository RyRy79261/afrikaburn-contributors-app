// Org-console permission LEVELS — the single authority for what each org rank
// may read and do (Ryan, 27 Jul 2026: "different team memberships give different
// CRUD operations in the Org portal").
//
// ONE MODULE, TWO READERS. The console gate (`requireOrgSession`) and the
// console UI both call `orgCan`. That is the whole point: a hidden button and a
// refused action can never disagree, because there is only one matrix. Hiding a
// control is still never the boundary (AGENTS.md rule 7) — every server action
// re-checks here — but a console that offers a button it will refuse is a bug of
// its own, and this stops both.
//
// THE RANKS (stored on `memberships.role`, org group only):
//
//   engineer   — IT/engineering. Reads EVERYWHERE, so they can see the state of
//                the system they run. Sees NO personal information, ever. Cannot
//                delete anything.
//   org_staff  — AfrikaBurn reviewers/coordinators. The ordinary operator tier:
//                reads people's details, reviews registrations, vets suppliers,
//                deletes stray catalogue rows.
//   god        — the System manager. Nothing is off limits; the audit log is
//                what keeps the behaviour good rather than a permission wall.
//
// THE RANKS ARE NOT A LADDER. `ORG_RANKS` is ordered lowest-first for display,
// but org_staff is NOT a superset of engineer: `read_system` is held by engineer
// and System manager and refused to org_staff, while `read_personal_information`
// and `delete` go the other way. That is the point — these are different JOBS,
// not seniority tiers, and a reviewer who assumes a ladder will write a check
// like `rank >= "org_staff"` that is wrong in both directions. Ask `orgCan`.
//
// `god` IS "System manager". The stored value stays `god` on purpose — renaming
// the enum would mean migrating live rows, re-cutting the GOD_EMAILS bootstrap
// and touching every god e2e spec, for a label. `ORG_RANK_LABELS` is the label
// layer; see @quagga/types roles.ts for the full note. Do not "fix" the
// inconsistency by renaming the enum.
//
// WHAT "PERSONAL INFORMATION" MEANS HERE — the load-bearing rule. An engineer
// must never RECEIVE any of these in a payload, not merely fail to see them
// rendered (a value a component skips still ships in the RSC payload):
//
//   · medical notes                          · phone numbers
//   · emergency contacts (name AND number)   · SA ID / passport
//   · legal names                            · email addresses
//   · which named burner has disclosed medical information at all
//
// That last one is not pedantry: a `bio.medical.view` audit row only exists when
// the subject HAS notes, so a named list of those rows is a census of who has
// disclosed a health condition — the same leak the member roster refuses to
// carry (see apps/org/lib/queries.ts `getRegistrationRoster`).
//
// Enforcement is at the QUERY, following the `canViewMedicalNotes` pattern: run
// the predicate BEFORE the select, and don't select the column when the answer
// is no. This module only answers the question.
//
// DEPARTMENTS are modelled as lightly as the org's own certainty about them: a
// free-text label and a lead flag on the org membership. They grant NOTHING
// today — see `OrgActor.department` below.

import type { MembershipRole } from "@quagga/types";

/**
 * The org-console ranks, LOWEST FIRST — as stored on `memberships.role`.
 * (`god` is displayed as "System manager"; see the header note.)
 */
export const ORG_RANKS = ["engineer", "org_staff", "god"] as const;
export type OrgRank = (typeof ORG_RANKS)[number];

/** How each rank is NAMED in the console. The label layer for `god`. */
export const ORG_RANK_LABELS: Record<OrgRank, string> = {
  engineer: "Engineer",
  org_staff: "Org staff",
  god: "System manager",
};

/** One honest line per rank, for the accounts panel and confirm dialogs. */
export const ORG_RANK_DESCRIPTIONS: Record<OrgRank, string> = {
  engineer:
    "Full read access to the console for the people who run it — no personal information, and nothing can be deleted.",
  org_staff:
    "Reviews registrations, vets suppliers and sees members' details. Cannot change anyone's access.",
  god: "Nothing is off limits. The audit log, not a permission wall, is what keeps this rank honest.",
};

const ORG_RANK_SET: ReadonlySet<string> = new Set(ORG_RANKS);

/**
 * The rank a membership role carries in the console, or null when the role is
 * not an org rank at all (`lead`/`admin`/`member` are project roles).
 */
export function orgRankFromRole(
  role: MembershipRole | null | undefined,
): OrgRank | null {
  return role != null && ORG_RANK_SET.has(role) ? (role as OrgRank) : null;
}

/**
 * The capabilities the console gates on.
 *
 * - `read` — see the console and its non-personal data. Every rank holds it:
 *   "has access everywhere" is the engineer's defining grant.
 * - `read_personal_information` — receive any of the field classes listed in
 *   the header. NEVER an engineer.
 * - `write` — ordinary, reversible console work: review a registration, set a
 *   supplier's standing, publish a bulletin, send a questionnaire. Held by
 *   every rank today — the engineer's two carve-outs are personal information
 *   and destruction, not ordinary work. It exists so that every mutation
 *   declares the capability it needs rather than declaring nothing, and so a
 *   future read-only rank has one line to change instead of thirty.
 * - `delete` — DESTRUCTIVE: removes a row (and its cascade) rather than moving
 *   it through a state machine. Never an engineer. A rejected registration is
 *   NOT this — nothing is destroyed and the decision is reversible.
 * - `manage_camp_categories` — the per-edition camp-category taxonomy, CRUD and
 *   assignment alike. System manager only (Ryan named this one).
 * - `manage_accounts` — grant, change or remove someone's org rank, and set
 *   their department. System manager only; already was.
 * - `read_system` — the System panel (`/system`): how the auth stack is
 *   actually configured, whether the deployment's backing services are healthy,
 *   and who holds org access. ENGINEER AND SYSTEM MANAGER ONLY — the one
 *   capability org_staff does not hold and engineer does (Ryan, 27 Jul 2026:
 *   "a System management panel for IT staff and System manager teams"). A
 *   registration reviewer has no use for the migration endpoint or the rate-limit
 *   ceiling, and putting it in front of them makes the console noisier for
 *   everyone. Note it is a READ: every control that ever mutates from that page
 *   names its own capability (`manage_accounts` today), so a future switch
 *   cannot ride in on page access.
 */
export const ORG_CAPABILITIES = [
  "read",
  "read_personal_information",
  "write",
  "delete",
  "manage_camp_categories",
  "manage_accounts",
  "read_system",
] as const;
export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

/**
 * The actor a capability check runs against.
 *
 * `department` and `isDepartmentLead` are carried but NOT consulted: AfrikaBurn
 * has a team lead per department (suppliers, theme camps, …), and the org
 * cannot yet say how many departments exist or what protocols they carry, so
 * inventing per-department privileges now would be inventing the org's shape for
 * it. They record WHO ANSWERS FOR WHAT and give a future rule somewhere to land
 * without another migration or a signature change at thirty call sites. When the
 * org says what a department decides, `orgCan` is the one place to wire it.
 */
export interface OrgActor {
  rank: OrgRank;
  /** Free-text department label, or null. Never consulted for authz today. */
  department: string | null;
  /** Whether they lead that department. Never consulted for authz today. */
  isDepartmentLead: boolean;
}

/** THE MATRIX. Everything else in this module reads from here. */
const RANK_CAPABILITIES: Record<OrgRank, readonly OrgCapability[]> = {
  engineer: ["read", "write", "read_system"],
  org_staff: ["read", "read_personal_information", "write", "delete"],
  god: [
    "read",
    "read_personal_information",
    "write",
    "delete",
    "manage_camp_categories",
    "manage_accounts",
    "read_system",
  ],
};

const RANK_CAPABILITY_SETS: Record<OrgRank, ReadonlySet<OrgCapability>> = {
  engineer: new Set(RANK_CAPABILITIES.engineer),
  org_staff: new Set(RANK_CAPABILITIES.org_staff),
  god: new Set(RANK_CAPABILITIES.god),
};

/**
 * May this actor do the thing? Pure and fail-closed — an unknown rank or an
 * unknown capability is a refusal, never a pass.
 */
export function orgCan(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): boolean {
  if (!actor) return false;
  const granted = RANK_CAPABILITY_SETS[actor.rank];
  return granted ? granted.has(capability) : false;
}

/** Every capability a rank holds, for the "what can I do here?" surfaces. */
export function orgCapabilitiesFor(rank: OrgRank): readonly OrgCapability[] {
  return RANK_CAPABILITIES[rank] ?? [];
}

/**
 * The refusal a blocked actor is TOLD, server-side. Honest about who they are
 * and what would be needed — "you can't do that" teaches nobody anything, and a
 * silently-hidden control teaches them less. Never leaks the blocked data.
 */
export function orgCapabilityRefusal(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): string {
  if (!actor) return "Not authorised for the organiser console.";
  const rank = ORG_RANK_LABELS[actor.rank];
  switch (capability) {
    case "read":
      return "Not authorised for the organiser console.";
    case "read_personal_information":
      return `${rank} accounts don't see personal information — names, contact details, ID numbers or medical notes. Everything else on this screen is yours.`;
    case "write":
      return `${rank} accounts can't make that change.`;
    case "delete":
      return `${rank} accounts can't delete things. Ask org staff or a ${ORG_RANK_LABELS.god.toLowerCase()} to remove it.`;
    case "manage_camp_categories":
      return `Camp categories are managed by a ${ORG_RANK_LABELS.god.toLowerCase()}, so ${rank.toLowerCase()} accounts can read them but not change them.`;
    case "manage_accounts":
      return `Only a ${ORG_RANK_LABELS.god.toLowerCase()} can change someone's org access.`;
    case "read_system":
      return `The system panel belongs to ${ORG_RANK_LABELS.engineer.toLowerCase()} and ${ORG_RANK_LABELS.god.toLowerCase()} accounts. It shows how this deployment is configured and whether its services are healthy — IT work rather than org work — so ${rank.toLowerCase()} accounts don't carry it.`;
  }
}

/**
 * Convenience for the many read paths that branch on personal information:
 * "does this actor get the columns?".
 */
export function canReadPersonalInformation(
  actor: OrgActor | null | undefined,
): boolean {
  return orgCan(actor, "read_personal_information");
}

/**
 * Normalise a department label for storage: trimmed, collapsed whitespace,
 * empty → null. No catalog, no validation against a list — there is no list,
 * and inventing one is the over-complication Ryan warned against.
 */
export function normalizeDepartment(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? null : trimmed.slice(0, 80);
}

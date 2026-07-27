// Org-console permission resolution — the single authority for what a console
// account may read and do.
//
// ONE MODULE, TWO READERS. The console gate (`requireOrgSession`) and the
// console UI both call `orgCan`. That is the whole point: a hidden button and a
// refused action can never disagree, because there is only one resolver. Hiding
// a control is still never the boundary (AGENTS.md rule 7) — every server action
// re-checks here — but a console that offers a button it will refuse is a bug of
// its own, and this stops both.
//
// ## WHAT CHANGED (org roles v1, migration 0018)
//
// There is no longer a hardcoded rank→capability matrix. Ryan, 27 Jul 2026:
// "system admins can simply have a roles management section and create n sign
// these things instead of needing to hardcode them? With some set permanent
// ones, like team leads and team members for each department domain, these cant
// be removed but they can have the rights edited."
//
// So: a System manager creates DEPARTMENTS (`org_departments`) and ROLES
// (`org_roles`), each role carrying a `permissions` object over the capability
// vocabulary below, and assigns roles to people (`org_role_assignments`). This
// module resolves the UNION of an actor's roles. That is the ONLY resolution
// path — the old `RANK_CAPABILITIES` table is gone rather than kept "just in
// case", because a second source of truth for permissions is how a console ends
// up refusing what it renders.
//
// `memberships.role` still exists and still matters, but on the org group it now
// means exactly two things:
//
//   · `god`                     — THE SYSTEM MANAGER, and the anti-lockout
//                                 anchor: resolves EVERY capability whatever any
//                                 role row says. Editable rights make lockout
//                                 possible; this is what makes it survivable. A
//                                 System manager cannot be defined out of
//                                 existence by editing a table.
//   · `org_staff` / `engineer`  — THE DOOR. This account may load the console.
//                                 Nothing more. What they may do comes from
//                                 their roles, and an account with no roles gets
//                                 the console shell and nothing in it.
//
// (`god` IS "System manager". The stored value stays `god` on purpose — renaming
// the enum would mean migrating live rows, re-cutting the GOD_EMAILS bootstrap
// and touching every god e2e spec, for a label. `ORG_RANK_LABELS` is the label
// layer; see @quagga/types roles.ts. Do not "fix" the inconsistency.)
//
// ## THERE IS NO LADDER, AND NOW THERE CANNOT BE ONE
//
// Roles are sets of grants, not tiers. Two accounts may hold overlapping,
// non-nested sets. Never write `rank >= "org_staff"`; ask `orgCan`.
//
// ## DEPARTMENT SCOPING
//
// A role may belong to a department. It then grants its capabilities ONLY for
// that department's things — which is how "org staff may only delete in their
// related department" is expressed now, as a scoped role rather than a hardcoded
// domain→department map. `orgCan` asks "may they, anywhere?" (the right question
// for a nav entry); `orgCanIn` asks "may they, for a thing belonging to THIS
// department?" (the right question for the action). A null-department role is
// org-wide and passes both.
//
// ## WHAT "PERSONAL INFORMATION" MEANS HERE — the load-bearing rule. An actor
// without `read_personal_information` must never RECEIVE any of these in a
// payload, not merely fail to see them rendered (a value a component skips still
// ships in the RSC payload):
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

import {
  ORG_CAPABILITY_KEYS,
  type MembershipRole,
  type OrgCapabilityKey,
  type OrgPermissions,
  type OrgRoleKind,
} from "@quagga/types";

/**
 * The org-group membership roles that open the console door.
 *
 * Kept as `ORG_RANKS` because that is what the DB rows are and what every query
 * filters on — but a "rank" is now a DOOR, not a set of rights. Nothing in this
 * module derives a capability from one, except `god`.
 */
export const ORG_RANKS = ["engineer", "org_staff", "god"] as const;
export type OrgRank = (typeof ORG_RANKS)[number];

/** How each is NAMED in the console. The label layer for `god`. */
export const ORG_RANK_LABELS: Record<OrgRank, string> = {
  engineer: "Engineer",
  org_staff: "Org staff",
  god: "System manager",
};

/** One honest line per rank, for the accounts panel and confirm dialogs. */
export const ORG_RANK_DESCRIPTIONS: Record<OrgRank, string> = {
  engineer:
    "Console access for the people who run the system. What they may actually read and do comes from the org roles you assign them — on their own, an account with no roles sees an empty console.",
  org_staff:
    "Console access for AfrikaBurn's org team. What they may actually read and do comes from the org roles you assign them — on their own, an account with no roles sees an empty console.",
  god: "Nothing is off limits, and no role edit can take that away — the System manager is the anchor that makes editable permissions safe. The audit log, not a permission wall, is what keeps this rank honest.",
};

const ORG_RANK_SET: ReadonlySet<string> = new Set(ORG_RANKS);

/**
 * The rank a membership role carries in the console, or null when the role is
 * not an org rank at all (`lead`/`admin`/`member` are project roles).
 *
 * THIS IS THE CONSOLE GATE and nothing else: a non-null answer means "may load
 * the console", never "may do anything in it".
 */
export function orgRankFromRole(
  role: MembershipRole | null | undefined,
): OrgRank | null {
  return role != null && ORG_RANK_SET.has(role) ? (role as OrgRank) : null;
}

/**
 * The capabilities a role's `permissions` object may grant, and every console
 * guard names one of them.
 *
 * The tuple itself lives in @quagga/types (the schema needs the type and must
 * not import core); the MEANINGS live here:
 *
 * - `read` — see the console and its non-personal data. The baseline grant: a
 *   role without it can open the shell and read nothing.
 * - `read_personal_information` — receive any of the field classes listed in
 *   the header.
 * - `write` — ordinary, reversible console work: review a registration, set a
 *   supplier's standing, publish a bulletin, send a questionnaire.
 * - `delete` — DESTRUCTIVE: removes a row (and its cascade) rather than moving
 *   it through a state machine. This is the capability most worth scoping to a
 *   department. A rejected registration is NOT this — nothing is destroyed and
 *   the decision is reversible.
 * - `manage_camp_categories` — the per-edition camp-category taxonomy, CRUD and
 *   assignment alike.
 * - `manage_accounts` — grant or remove someone's console access and assign
 *   their org roles. SYSTEM MANAGER ONLY AND NOT GRANTABLE — see
 *   `SYSTEM_MANAGER_ONLY_CAPABILITIES`.
 * - `read_system` — the System panel (`/system`): how the auth stack is
 *   configured, whether the backing services are healthy, and who holds org
 *   access. Note it is a READ: every control on that page names its own
 *   capability (`manage_accounts` today), so a future switch cannot ride in on
 *   page access.
 */
export const ORG_CAPABILITIES = ORG_CAPABILITY_KEYS;
export type OrgCapability = OrgCapabilityKey;

/**
 * Capabilities NO ROLE MAY EVER CARRY — the System manager's alone, enforced in
 * `orgCan` itself rather than only at the write path.
 *
 * `manage_accounts` is the door to editing rights: granting console access and
 * assigning roles. If a role could carry it, a System manager could hand out the
 * ability to hand out abilities, and the "only a system manager may manage
 * departments, roles or assignments" rail would hold only until the first
 * well-meaning edit. Fail-closed here means a hand-written row in the database
 * still cannot escalate.
 */
export const SYSTEM_MANAGER_ONLY_CAPABILITIES: readonly OrgCapability[] = [
  "manage_accounts",
];

const SYSTEM_MANAGER_ONLY_SET: ReadonlySet<OrgCapability> = new Set(
  SYSTEM_MANAGER_ONLY_CAPABILITIES,
);

/** The capabilities the role editor may actually offer as toggles. */
export const GRANTABLE_ORG_CAPABILITIES: readonly OrgCapability[] =
  ORG_CAPABILITIES.filter((c) => !SYSTEM_MANAGER_ONLY_SET.has(c));

/**
 * Capabilities whose grant is CONFINED BY A ROLE'S DEPARTMENT — and which
 * therefore fail closed when the caller does not say which department the thing
 * being acted on belongs to.
 *
 * Only `delete` today, because destruction is what Ryan scoped ("org_staff can
 * only delete in their related department") and because it is the one that
 * cannot be undone. `read`/`write` are NOT here on purpose: a department member
 * whose ordinary work silently resolved to nothing — which is what a strict
 * default would do until every console entity carries a department — would be a
 * role that looks granted and does nothing, the worst of both.
 *
 * THE HONEST CONSEQUENCE, stated rather than discovered: no console entity
 * carries a department column yet, so a department-scoped `delete` grants
 * nothing at all right now. That is the fail-closed direction. When suppliers or
 * categories start declaring a department, their delete guards pass it to
 * `requireOrgSession({ capability: "delete", departmentId })` and the scope
 * starts meaning something without any change here.
 */
export const DEPARTMENT_SCOPED_CAPABILITIES: readonly OrgCapability[] = [
  "delete",
];

const DEPARTMENT_SCOPED_SET: ReadonlySet<OrgCapability> = new Set(
  DEPARTMENT_SCOPED_CAPABILITIES,
);

/** True when a capability's grant is confined by the granting role's department. */
export function isDepartmentScopedCapability(
  capability: OrgCapability,
): boolean {
  return DEPARTMENT_SCOPED_SET.has(capability);
}

/**
 * THREE COPY TABLES, three jobs — and every one of them describes a CONSEQUENCE
 * rather than a permission key. Someone editing a role is deciding what a
 * colleague can destroy, so "delete: true" is not an acceptable thing to put in
 * front of them; "can permanently remove suppliers" is.
 *
 *   · LABELS       — the chip / toggle heading. Two or three words.
 *   · CONSEQUENCES — a verb phrase that completes "This account can …".
 *                    Used wherever a RESOLVED actor is summarised (the accounts
 *                    table, the assignment dialog's live preview).
 *   · DESCRIPTIONS — the sentence under the checkbox in the role editor, naming
 *                    what a holder can actually reach or destroy TODAY.
 *
 * Each is written against the guards that exist, not against an aspiration:
 * `delete` names suppliers and supplier documents because
 * `deleteSupplier` / `deleteSupplierDocument` are the only two actions that ask
 * for it (apps/org/lib/actions). When a third one does, this copy changes with
 * it — a promise the console cannot keep is worse than no promise.
 */
export const ORG_CAPABILITY_LABELS: Record<OrgCapability, string> = {
  read: "Read the console",
  read_personal_information: "See personal information",
  write: "Make ordinary changes",
  delete: "Permanently delete",
  manage_camp_categories: "Manage camp categories",
  manage_accounts: "Manage accounts and roles",
  read_system: "Open the system panel",
};

/** A verb phrase completing "This account can …". Lowercase, no full stop. */
export const ORG_CAPABILITY_CONSEQUENCES: Record<OrgCapability, string> = {
  read: "read the console — registrations, camps, suppliers, bulletins and questionnaires",
  read_personal_information:
    "read people's names, email addresses, phone numbers, ID numbers, emergency contacts and medical notes",
  write:
    "approve, reject or send back registrations, change supplier standing and publish bulletins",
  delete: "permanently remove suppliers and their documents",
  manage_camp_categories: "add, rename and remove camp categories",
  manage_accounts: "grant console access and edit everyone's roles",
  read_system: "open the system panel and read how this deployment is configured",
};

/** The sentence under the checkbox in the role editor. */
export const ORG_CAPABILITY_DESCRIPTIONS: Record<OrgCapability, string> = {
  read: "Opens the console and reads what is in it: registrations, camps, suppliers, bulletins, questionnaires, the status board. Without this, the console opens empty.",
  read_personal_information:
    "Reads burners' legal names, email addresses, phone numbers, SA ID and passport numbers, emergency contacts and medical notes. Give it to the people whose job needs it and to nobody else.",
  write:
    "Approves, rejects and sends back camp registrations, opens and resolves review threads, changes a supplier's standing and onboarding, and publishes bulletins every camp lead sees. Everyday work, and all of it reversible.",
  delete:
    "Permanently removes a supplier and everything hanging off them, and removes supplier documents. Destroyed, not archived: there is no undo. (Rejecting a registration is NOT this — nothing is destroyed and the decision can be changed.)",
  manage_camp_categories:
    "Adds, renames and removes the camp categories every registration is filed under, and re-files camps between them.",
  manage_accounts:
    "Grants console access, assigns roles, creates departments. The System manager holds this and no role can be given it — the one thing that cannot be edited away.",
  read_system:
    "Opens the system panel: how this deployment is configured and whether its services are answering. Reads only — no personal information, nothing destructive.",
};

/**
 * What a role scoped to a department ACTUALLY grants today, said out loud
 * wherever a scoped `delete` is offered or displayed.
 *
 * Not a caveat in a comment: no console entity carries a department column yet,
 * so `orgCanIn` resolves every delete target as unfiled and a department-scoped
 * delete permits nothing at all. Fail-closed and correct — and a role that looks
 * granted while granting nothing is exactly the thing someone must not discover
 * by being refused in front of a colleague.
 */
export const DEPARTMENT_SCOPE_TODAY =
  "Nothing in the console is filed under a department yet, so a department-scoped delete permits nothing until an entity declares one. An org-wide role is what deletes today.";

/**
 * One org role the actor holds, as resolved from `org_roles` +
 * `org_role_assignments`. Carries only what resolution needs.
 */
export interface OrgRoleGrant {
  id: string;
  /** Stable key (`org_staff`, `engineer`, `suppliers.lead`, `custom.<slug>`). */
  key: string;
  /** Display label — the System manager may rename any role. */
  name: string;
  kind: OrgRoleKind;
  /** The department this role is scoped to, or null for org-wide. */
  departmentId: string | null;
  permissions: OrgPermissions;
}

/**
 * The actor a capability check runs against.
 *
 * `rank` is the door plus the `god` anchor; `roles` is everything else. A god
 * with zero roles still holds every capability — that is deliberate and is what
 * keeps a mis-edited permissions table recoverable.
 */
export interface OrgActor {
  rank: OrgRank;
  roles: readonly OrgRoleGrant[];
}

/**
 * Is this actor the System manager? The `god` membership role IS the answer —
 * never a role row, never a permission bit, so nothing editable can change it.
 */
export function isSystemManager(actor: OrgActor | null | undefined): boolean {
  return actor?.rank === "god";
}

/** Does one role's permissions object grant a capability? Fail-closed. */
function roleGrants(role: OrgRoleGrant, capability: OrgCapability): boolean {
  return role.permissions?.[capability] === true;
}

/**
 * May this actor do the thing ANYWHERE? The union of their roles' permissions.
 *
 * Pure and fail-closed — no actor, no roles, an unknown capability or a role
 * whose permissions object is missing the key are all refusals. A
 * department-scoped role answers TRUE here, because "may they delete at all?"
 * is the right question for a nav entry or an affordance; the action itself must
 * ask `orgCanIn` with the department of the thing being acted on.
 */
export function orgCan(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): boolean {
  if (!actor) return false;
  if (isSystemManager(actor)) return true;
  // Not grantable to any role, at any time, however the row was written.
  if (SYSTEM_MANAGER_ONLY_SET.has(capability)) return false;
  return actor.roles.some((role) => roleGrants(role, capability));
}

/**
 * May this actor do the thing TO A THING THAT BELONGS TO `departmentId`?
 *
 * - System manager → always.
 * - An org-wide role (`departmentId === null`) that grants the capability → yes,
 *   for anything.
 * - A department-scoped role → only when the ids match.
 * - A target with NO department (`null`) → only org-wide roles reach it, because
 *   a departmental grant is a grant over that department's things and an
 *   unfiled thing belongs to no department.
 *
 * This is the delete-scoping rule, and it is enforced here rather than at thirty
 * call sites.
 */
export function orgCanIn(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
  departmentId: string | null,
): boolean {
  if (!actor) return false;
  if (isSystemManager(actor)) return true;
  if (SYSTEM_MANAGER_ONLY_SET.has(capability)) return false;
  return actor.roles.some(
    (role) =>
      roleGrants(role, capability) &&
      (role.departmentId === null ||
        (departmentId !== null && role.departmentId === departmentId)),
  );
}

/**
 * True when the actor's grant of `capability` is DEPARTMENT-SCOPED — they hold
 * it somewhere but not everywhere. The console uses this to say so out loud
 * ("you can delete suppliers in Suppliers") instead of letting someone discover
 * it by being refused.
 */
export function isDepartmentScopedGrant(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): boolean {
  if (!actor || isSystemManager(actor)) return false;
  if (!orgCan(actor, capability)) return false;
  return !actor.roles.some(
    (role) => roleGrants(role, capability) && role.departmentId === null,
  );
}

/** The departments an actor holds `capability` in (empty when org-wide/none). */
export function departmentsGranting(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): string[] {
  if (!actor) return [];
  const ids = new Set<string>();
  for (const role of actor.roles) {
    if (roleGrants(role, capability) && role.departmentId !== null) {
      ids.add(role.departmentId);
    }
  }
  return [...ids];
}

/** Every capability an actor holds anywhere, for the "what can I do here?" surfaces. */
export function orgCapabilitiesFor(
  actor: OrgActor | null | undefined,
): readonly OrgCapability[] {
  return ORG_CAPABILITIES.filter((c) => orgCan(actor, c));
}

/**
 * The refusal a blocked actor is TOLD, server-side. Honest about what is missing
 * and who can fix it — "you can't do that" teaches nobody anything, and a
 * silently-hidden control teaches them less. Never leaks the blocked data, and
 * never says "god" out loud: the console calls that rank System manager.
 */
export function orgCapabilityRefusal(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): string {
  if (!actor) return "Not authorised for the organiser console.";
  const manager = ORG_RANK_LABELS.god;
  const ask = `Ask a ${manager.toLowerCase()} to add it to one of your roles.`;
  const noRoles = actor.roles.length === 0;
  if (noRoles && capability !== "manage_accounts") {
    return `Your account can open the console but holds no org roles yet, so there is nothing it can do here. A ${manager.toLowerCase()} assigns roles from the Accounts screen.`;
  }
  switch (capability) {
    case "read":
      return `None of your org roles grant reading this. ${ask}`;
    case "read_personal_information":
      return `None of your org roles see personal information — names, contact details, ID numbers or medical notes. Everything else on this screen is yours. ${ask}`;
    case "write":
      return `None of your org roles can make that change. ${ask}`;
    case "delete":
      return isDepartmentScopedGrant(actor, "delete")
        ? "You can delete things in your own department, and this one belongs to another. That scope is set by the role you hold."
        : `None of your org roles can delete things. ${ask}`;
    case "manage_camp_categories":
      return `None of your org roles manage camp categories, so you can read the taxonomy but not change it. ${ask}`;
    case "manage_accounts":
      return `Only a ${manager.toLowerCase()} can change someone's org access or edit roles. That one is deliberately not grantable — it is what keeps every other permission safe to edit.`;
    case "read_system":
      return `None of your org roles open the system panel. It shows how this deployment is configured and whether its services are healthy — IT work rather than org work. ${ask}`;
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
 * Coerce a permissions object to what a role is ALLOWED to store: every
 * ungrantable capability stripped, every other key normalised to a present-and-
 * true / absent form. Mirrors `enforceKindPermissions` on the camp side — the
 * write path calls it so a crafted payload cannot store `manage_accounts: true`,
 * and `orgCan` refuses it anyway if one ever appears.
 */
export function sanitizeOrgPermissions(
  permissions: OrgPermissions | null | undefined,
): OrgPermissions {
  const out: OrgPermissions = {};
  if (!permissions) return out;
  for (const key of GRANTABLE_ORG_CAPABILITIES) {
    if (permissions[key] === true) out[key] = true;
  }
  return out;
}

/** Build a permissions object from a list of capability keys (form input). */
export function orgPermissionsFromKeys(
  keys: readonly OrgCapability[],
): OrgPermissions {
  const out: OrgPermissions = {};
  for (const key of keys) {
    if (SYSTEM_MANAGER_ONLY_SET.has(key)) continue;
    out[key] = true;
  }
  return out;
}

/**
 * ONE RESOLVED CAPABILITY an actor holds, and WHERE.
 *
 * `departmentIds === null` means org-wide — it applies to everything. A non-null
 * array means the actor holds this capability only for those departments' things
 * (and it is never empty: an empty scope is not a grant).
 */
export interface OrgCapabilityGrant {
  capability: OrgCapability;
  departmentIds: string[] | null;
}

/**
 * EVERYTHING AN ACTOR CAN ACTUALLY DO, with the scope resolved — the union of
 * their roles, answered once so a reviewer never has to add up role chips in
 * their head.
 *
 * This is the function behind "what can this person delete?" on the accounts
 * screen and behind the live preview in the assignment dialog. Both call it, and
 * so it is deliberately PURE and free of DB or React: the summary a System
 * manager reads before saving and the summary the table shows afterwards are
 * produced by the same code as the refusal itself (`orgCan` / `orgCanIn` are its
 * only sources of truth), so the console cannot describe an access it would not
 * grant.
 *
 * A System manager resolves everything, org-wide, including the capabilities no
 * role may carry — that is what the anchor means and the summary says so rather
 * than quietly listing the grantable subset.
 *
 * A SCOPE IS ONLY REPORTED WHERE ONE IS ENFORCED. A role's department narrows
 * `delete` and nothing else (`DEPARTMENT_SCOPED_CAPABILITIES`), so a "Suppliers
 * member" whose role grants `read` reads the WHOLE console — `requireOrgSession`
 * resolves unscoped capabilities through `orgCan`, which does not look at the
 * department at all. Reporting "reads, in Suppliers only" would be a smaller
 * claim than the truth, and a summary that under-states access is as dangerous
 * as one that over-states it: it is read by the person deciding whether the
 * grant is acceptable.
 */
export function summarizeOrgActor(
  actor: OrgActor | null | undefined,
): OrgCapabilityGrant[] {
  if (!actor) return [];
  return ORG_CAPABILITIES.filter((c) => orgCan(actor, c)).map((capability) => ({
    capability,
    departmentIds:
      isDepartmentScopedCapability(capability) &&
      isDepartmentScopedGrant(actor, capability)
        ? departmentsGranting(actor, capability)
        : null,
  }));
}

/** The capability keys a permissions object grants, in vocabulary order. */
export function grantedOrgCapabilities(
  permissions: OrgPermissions | null | undefined,
): OrgCapability[] {
  if (!permissions) return [];
  return ORG_CAPABILITIES.filter((c) => permissions[c] === true);
}

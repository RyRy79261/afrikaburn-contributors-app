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
// ## THE RANKS ARE CUMULATIVE IN REACH, NOT IN DEPTH
//
// Ryan, 27 Jul 2026: "You can consider an engineer as part of all staff… you got
// org staff and then whatever departments they're in. You can have an engineer
// who is still also org staff but they're a step up and then sys admin or gods
// are still org but they're above that."
//
// So all three ranks are org. What differs is REACH — how many departments an
// account's grants apply in:
//
//   · org_staff — the departments whose roles they hold (org-wide roles: all).
//   · engineer  — EVERY department, always. They run the system; there is no
//                 corner of it they are outside of.
//   · god       — everything, in every sense, whatever any row says.
//
// AND THEN THE PART THAT LOOKS LIKE A BUG AND IS NOT (`ENGINEER_RANK_CARVE_OUTS`
// below): an engineer NEVER resolves `read_personal_information` or `delete`,
// whatever role they are given. Broader in reach, deliberately narrower in
// depth. That makes the engineer rank NOT a superset of org_staff — an org_staff
// account can read a phone number and destroy a supplier; an engineer cannot,
// anywhere, ever. Someone will read `rank === "engineer" → return false` as an
// inverted comparison and "fix" it. It is the carve-out, it is Ryan's, and
// removing it hands every engineer every burner's contact details.
//
// ## DEPARTMENT SCOPING — AND WHAT A DEPARTMENT OWNS
//
// A role may belong to a department. It then grants its capabilities ONLY for
// that department's things. What "that department's things" MEANS lives in
// `org-domains.ts`: a department owns a set of DOMAIN KEYS (suppliers, supplier
// documents, registrations, questionnaires…), and an entity's department is
// whichever department owns the domain it lives in. No row carries a department
// column; the subject area does.
//
// Three questions, three functions, and using the wrong one is the whole hazard:
//
//   · `orgCan`         — "may they, ANYWHERE?"  → nav entries, affordances.
//   · `orgCanIn`       — "may they, for a thing in THIS department?" (by id).
//   · `orgCanInDomain` — "may they, for a thing in THIS domain?" → what guards
//                        and queries actually ask, because a call site knows
//                        which screen it is on and knows no department id.
//
// A null-department role is org-wide and passes all three. A domain no
// department owns resolves to no department, so only an org-wide role reaches
// it — fail-closed, and true on day one when nothing is assigned yet.
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
//
// AND SINCE 27 JUL 2026 THAT QUESTION TAKES A DOMAIN. `read_personal_information`
// is department-scoped like `delete`, because Ryan's correction was precisely
// that a Suppliers lead reads supply-related contact details and NOT a theme
// camp's members' medical notes. So a query does not ask "does this actor read
// personal information?" — it asks "does this actor read personal information
// HERE?", naming the domain of the screen it is on
// (`canReadPersonalInformationIn`). The un-domained
// `canReadPersonalInformationAnywhere` exists only for affordances, and a query
// that reaches for it is a bug.

import {
  ORG_CAPABILITY_KEYS,
  type MembershipRole,
  type OrgCapabilityKey,
  type OrgPermissions,
  type OrgRoleKind,
} from "@quagga/types";

import {
  departmentForDomain,
  departmentOwning,
  domainsOwnedBy,
  listDomainLabels,
  ORG_DOMAIN_LABELS,
  type DomainOwnership,
  type OrgDomain,
} from "./org-domains";

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
 * Capabilities NO ROLE MAY EVER CARRY — now EMPTY, deliberately.
 *
 * This used to hold `manage_accounts`: the right to grant rights, which no role
 * could carry because a System manager could otherwise hand out the ability to
 * hand out abilities. That reasoning was right and the mechanism is still in
 * force — it just is not a *capability* any more. Administering the deployment
 * (console access, roles, departments, the system panel) is the System manager
 * RANK, asked as `isSystemManager`, and a rank cannot be written into a
 * permissions row at all.
 *
 * Kept as an empty set rather than deleted because it is the enforcement point:
 * if a future capability must never be grantable, it goes here and `orgCan`
 * refuses it however the row was written.
 */
export const SYSTEM_MANAGER_ONLY_CAPABILITIES: readonly OrgCapability[] = [];

const SYSTEM_MANAGER_ONLY_SET: ReadonlySet<OrgCapability> = new Set(
  SYSTEM_MANAGER_ONLY_CAPABILITIES,
);

export const GRANTABLE_ORG_CAPABILITIES: readonly OrgCapability[] =
  ORG_CAPABILITIES.filter((c) => !SYSTEM_MANAGER_ONLY_SET.has(c));

/**
 * Capabilities whose grant is CONFINED BY A ROLE'S DEPARTMENT — and which
 * therefore fail closed when the caller does not say which domain the thing
 * being acted on lives in.
 *
 * TWO, and they are the two that hurt:
 *
 *  · `delete` — destruction, which Ryan scoped first ("org_staff can only
 *    delete in their related department") and which cannot be undone.
 *  · `read_personal_information` — added 27 Jul 2026, and the reason this
 *    change exists. Ryan: "supplier leads would be able to read the PII of
 *    ANYTHING SUPPLY-RELATED." The corollary is the point: a Suppliers lead
 *    must NOT read a theme camp's members' details. While this was global, a
 *    department lead read everyone's — silently, in an RSC payload, with no
 *    refusal anywhere to notice.
 *
 * `read`/`write` are NOT here on purpose, and it is not an oversight to fix
 * later. Ordinary work is how a department member does their job across a
 * console whose screens mostly are not filed under anything; confining it would
 * turn every departmental role into a role that looks granted and does nothing.
 * Destroying a row and reading a person's medical notes are different in kind:
 * both are irreversible in their own way, and both are what a department
 * boundary exists to draw.
 */
export const DEPARTMENT_SCOPED_CAPABILITIES: readonly OrgCapability[] =
  ORG_CAPABILITIES;

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
 * THE ENGINEER CARVE-OUTS — capabilities the `engineer` RANK never resolves,
 * however its roles are edited. Read the "cumulative in reach, not in depth"
 * section of the header before touching this.
 *
 * An engineer is org staff with the run-the-system job and universal reach: they
 * are in every department, and no departmental boundary confines them. What
 * their reach does NOT include is people's details and destruction — the two
 * carve-outs the rank has had since it existed, kept deliberately while its
 * reach widened.
 *
 * This is a CEILING ON THE RANK, not a default on a row. That is a real
 * narrowing of what a System manager can express (the Engineer *role* can be
 * given personal information, and it will do nothing for an account whose rank
 * is engineer), and it is the trade taken on purpose: an engineer with universal
 * reach and no ceiling is one role assignment away from every burner's phone
 * number in every department at once. An engineer who genuinely needs to read
 * people's details is doing org work, and the answer is the org_staff door.
 *
 * `summarizeOrgActor` resolves through the same predicate, so the accounts
 * screen shows an engineer what they actually hold rather than what their roles
 * claim — the console never advertises an access it would refuse.
 */
export const ENGINEER_RANK_CARVE_OUTS: readonly OrgCapability[] = [
  "personal_information",
  "delete",
];

const ENGINEER_CARVE_OUT_SET: ReadonlySet<OrgCapability> = new Set(
  ENGINEER_RANK_CARVE_OUTS,
);

/** True when this actor's RANK refuses the capability outright, before any role
 * is consulted. Only the engineer carve-outs do this; a god is exempt (checked
 * first by every caller) and org_staff has no ceiling. */
export function isRankCarveOut(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): boolean {
  return actor?.rank === "engineer" && ENGINEER_CARVE_OUT_SET.has(capability);
}

/**
 * True when the actor's rank puts them in EVERY department, so a role's
 * department does not confine them. Engineers only — and never for a carve-out,
 * which they do not hold at all and so cannot hold everywhere.
 */
export function reachesEveryDepartment(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
): boolean {
  return actor?.rank === "engineer" && !ENGINEER_CARVE_OUT_SET.has(capability);
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
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
  personal_information: "See personal information",
};

/** A verb phrase completing "This account can …". Lowercase, no full stop. */
export const ORG_CAPABILITY_CONSEQUENCES: Record<OrgCapability, string> = {
  create: "add new records in this department's part of the console",
  read: "open and read this department's part of the console",
  update: "change existing records in this department's part of the console",
  delete: "permanently destroy records in this department's part of the console",
  personal_information:
    "read people's names, email addresses, phone numbers, ID numbers, emergency contacts and medical notes in this department's part of the console",
};

/** The sentence under the checkbox in the role editor. */
export const ORG_CAPABILITY_DESCRIPTIONS: Record<OrgCapability, string> = {
  create:
    "Adds new records — a supplier, a document, a bulletin, a questionnaire, a review thread — in the domains this department owns.",
  read: "Opens and reads the domains this department owns. Without this, those screens are empty rather than hidden: the console never pretends a thing does not exist.",
  update:
    "Changes records that already exist: approving or sending back a registration, moving a supplier's standing or onboarding step, publishing a bulletin, closing an activation. Everyday work, and reversible.",
  delete:
    "Permanently destroys records in the domains this department owns. Destroyed, not archived — there is no undo. (Rejecting a registration is NOT this: nothing is destroyed and the decision can be changed.)",
  personal_information:
    "Reads burners' legal names, email addresses, phone numbers, SA ID and passport numbers, emergency contacts and medical notes — in the domains this department owns and nowhere else. A supplier lead reads supply-related details, never a theme camp's members. Give it to the people whose job needs it and to nobody else; org-level reads of personal information are recorded.",
};

/**
 * The standing rule about a department-scoped grant, shown wherever one is
 * offered. The DEPARTMENT-SPECIFIC version — which domains this particular
 * department owns, and the warning when it owns none — is
 * `departmentDomainsNote` in `org-domains.ts`, because that answer depends on
 * data and this one does not.
 *
 * (This replaced a flat "nothing in the console is filed under a department
 * yet" constant. That was true while no entity could declare one and became a
 * lie the moment departments could own domains — the exact class of copy that
 * teaches someone to distrust the console.)
 */
export const DEPARTMENT_SCOPE_NOTE =
  "A department-scoped role reaches only the parts of the console its department owns. A department that owns none reaches nothing.";

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
 * `rank` is the door, the reach and the `god` anchor; `roles` is everything
 * else. A god with zero roles still holds every capability — that is deliberate
 * and is what keeps a mis-edited permissions table recoverable.
 *
 * `domains` is the DEPLOYMENT'S ownership map, not a property of this person:
 * which department owns which part of the console. It rides here because every
 * scoped question needs it and a caller threading it separately is a caller who
 * will one day forget, resolving a scoped check against an empty map and
 * granting nothing (or, if it were optional and defaulted the other way,
 * everything). Required and explicit — an empty map is the honest "nothing is
 * filed anywhere yet" state and fails closed.
 */
export interface OrgActor {
  rank: OrgRank;
  roles: readonly OrgRoleGrant[];
  domains: DomainOwnership;
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
  // The engineer ceiling: universal reach, and never these two. See
  // ENGINEER_RANK_CARVE_OUTS — this is not an inverted comparison.
  if (isRankCarveOut(actor, capability)) return false;
  return actor.roles.some((role) => roleGrants(role, capability));
}

/**
 * May this actor do the thing TO A THING THAT BELONGS TO `departmentId`?
 *
 * - System manager → always.
 * - An engineer → their reach is every department, so a role's own department
 *   never confines them. (Their two carve-outs are refused above, so this
 *   widening can never widen personal information or deletion.)
 * - An org-wide role (`departmentId === null`) that grants the capability → yes,
 *   for anything.
 * - A department-scoped role → only when the ids match.
 * - A target with NO department (`null`) → only org-wide roles reach it, because
 *   a departmental grant is a grant over that department's things and a domain
 *   nobody owns belongs to no department.
 *
 * This is the scoping rule, enforced here rather than at thirty call sites.
 * Most callers should be asking `orgCanInDomain` — a guard knows which screen it
 * is on, not which department id owns it.
 */
export function orgCanIn(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
  departmentId: string | null,
): boolean {
  if (!actor) return false;
  if (isSystemManager(actor)) return true;
  if (SYSTEM_MANAGER_ONLY_SET.has(capability)) return false;
  if (isRankCarveOut(actor, capability)) return false;
  const everywhere = reachesEveryDepartment(actor, capability);
  return actor.roles.some(
    (role) =>
      roleGrants(role, capability) &&
      (role.departmentId === null ||
        everywhere ||
        (departmentId !== null && role.departmentId === departmentId)),
  );
}

/**
 * MAY THIS ACTOR DO THE THING ON THIS PART OF THE CONSOLE? — the question guards
 * and queries actually have.
 *
 * A call site knows it is the suppliers screen; it does not know, and must not
 * have to look up, which department owns suppliers today. This resolves the
 * domain to its owning department through the actor's ownership map and defers
 * to `orgCanIn`.
 *
 * `domain: null` means "the caller named no domain", which resolves to no
 * department — only an org-wide role passes. That is the fail-closed direction
 * and it is what stops a guard that forgot to say where it is from handing a
 * departmental role the whole console.
 */
export function orgCanInDomain(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
  domain: OrgDomain | null,
): boolean {
  if (!actor) return false;
  return orgCanIn(
    actor,
    capability,
    departmentForDomain(actor.domains, domain),
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
  // An engineer is in every department, so nothing they hold is confined to one.
  if (reachesEveryDepartment(actor, capability)) return false;
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
 * WHY A SCOPED GRANT DID NOT REACH HERE — the sentence that has to be true.
 *
 * The old copy said "this one belongs to another department" for every scoped
 * refusal, which was a lie in the only case that could happen: nothing belonged
 * to any department, so the real reason was always "this belongs to nobody".
 * Being told a false reason is worse than being told none — it sends someone to
 * argue with the wrong colleague. So there are three distinct answers, and which
 * one you get depends on the data:
 *
 *   · the domain is owned by a department that is not one of yours;
 *   · the domain is owned by NOBODY, so only an org-wide role reaches it;
 *   · the caller named no domain at all (a guard that did not say where it is).
 */
function scopeReason(
  actor: OrgActor,
  domain: OrgDomain | null,
  verb: string,
): string {
  if (!domain) {
    return `Your ${verb} is scoped to your own department, and this action did not say which part of the console it belongs to — so it resolves as belonging to none. Only an org-wide role reaches those.`;
  }
  const owner = departmentOwning(actor.domains, domain);
  const label = ORG_DOMAIN_LABELS[domain].toLowerCase();
  if (!owner) {
    return `This part of the console — ${label} — is not owned by any department yet, so only an org-wide role reaches it, and your ${verb} is scoped to your own department. A ${ORG_RANK_LABELS.god.toLowerCase()} can give ${label} to your department on the Roles screen.`;
  }
  return `This part of the console — ${label} — belongs to ${owner.name}, and your ${verb} is scoped to your own department. That boundary is the role you hold, not this screen.`;
}

/**
 * The refusal a blocked actor is TOLD, server-side. Honest about what is missing
 * and who can fix it — "you can't do that" teaches nobody anything, and a
 * silently-hidden control teaches them less. Never leaks the blocked data, and
 * never says "god" out loud: the console calls that rank System manager.
 *
 * NO PER-CAPABILITY SWITCH. This used to be one `case` per capability, which is
 * the same shape that let `manage_camp_categories` exist: a vocabulary where
 * adding a feature meant adding an arm. The refusal is now composed from the
 * capability's own label plus WHY it failed, so a new domain needs no new copy
 * and a new capability needs one row in `ORG_CAPABILITY_CONSEQUENCES`.
 *
 * `domain` is the part of the console the refused action was on. Pass it
 * wherever it is known: it is the difference between "your role does not reach
 * here" and a sentence naming which department does.
 */
export function orgCapabilityRefusal(
  actor: OrgActor | null | undefined,
  capability: OrgCapability,
  domain: OrgDomain | null = null,
): string {
  if (!actor) return "Not authorised for the organiser console.";
  const manager = ORG_RANK_LABELS.god.toLowerCase();
  const ask = `Ask a ${manager} to add it to one of your roles.`;
  const doing = ORG_CAPABILITY_CONSEQUENCES[capability];

  // The rank ceiling comes FIRST, because for an engineer it is the whole
  // answer and "none of your roles grant it" would send them to ask for a role
  // edit that cannot work.
  if (isRankCarveOut(actor, capability)) {
    return capability === "delete"
      ? `${ORG_RANK_LABELS.engineer} accounts reach every department, and deliberately cannot delete anything in any of them. Destroying org data is org work — ask someone with the org staff door to do it, or ask a ${manager} to change your access.`
      : `${ORG_RANK_LABELS.engineer} accounts reach every department, and deliberately never see personal information — names, contact details, ID numbers or medical notes — in any of them. Everything else on this screen is yours. No role edit changes that; the ${manager} would have to change your access itself.`;
  }

  if (SYSTEM_MANAGER_ONLY_SET.has(capability)) {
    return `Only a ${manager} can do that. It is deliberately not grantable to a role — it is what keeps every other permission safe to edit.`;
  }

  if (actor.roles.length === 0) {
    return `Your account can open the console but holds no org roles yet, so there is nothing it can do here. A ${manager} assigns roles from the Accounts screen.`;
  }

  // Held SOMEWHERE but not here: the department boundary is the reason, and
  // naming which department owns this screen is the useful half.
  if (isDepartmentScopedGrant(actor, capability)) {
    return `You can ${doing} in your own department only. ${scopeReason(actor, domain, ORG_CAPABILITY_LABELS[capability].toLowerCase())}`;
  }

  return `None of your org roles ${doing}. ${ask}`;
}

/**
 * DOES THIS ACTOR RUN THE DEPLOYMENT? — the system panel's question.
 *
 * Engineers AND System managers, and it is a RANK question rather than a
 * capability: "who runs this deployment" is the engineer's whole job
 * description, not something a department grants.
 *
 * This replaced the `read_system` capability. Collapsing that into
 * `isSystemManager` would have been the tidy-looking mistake — it would have
 * locked engineers out of the panel that exists for them, which the console
 * header has always said is theirs ("Engineer and System manager only"). The
 * capability was never departmental, so it had no business in a department's
 * CRUD vocabulary; it belongs here, next to the ranks.
 */
export function runsDeployment(actor: OrgActor | null | undefined): boolean {
  return actor?.rank === "engineer" || actor?.rank === "god";
}

/** The refusal for a deployment-running surface. */
export function runsDeploymentRefusal(): string {
  return `The system panel shows how this deployment is configured and whether its services are healthy — IT work rather than org work, so it is open to ${ORG_RANK_LABELS.engineer.toLowerCase()} and ${ORG_RANK_LABELS.god.toLowerCase()} accounts only. Nothing on it is personal or destructible; you are not missing org work.`;
}

/**
 * THE ADMIN REFUSAL — administering the deployment is the System manager RANK,
 * not a capability, so it needs its own sentence rather than an arm in the
 * capability refusal.
 *
 * `what` names the thing that was refused, lowercase, no full stop: "change
 * someone's org access", "open the system panel", "manage departments".
 */
export function systemManagerRefusal(what: string): string {
  const manager = ORG_RANK_LABELS.god.toLowerCase();
  return `Only a ${manager} can ${what}. That is the rank rather than a permission, so it cannot be granted to a role — which is what keeps every other permission safe to edit.`;
}

/**
 * DOES THIS ACTOR GET THE PERSONAL COLUMNS ON THIS SCREEN? — what every
 * people-returning query asks, before its select.
 *
 * The domain is not optional and there is no default, because the default would
 * be the bug: a query that forgot to say where it is would either withhold from
 * everyone (a visible, reported failure) or — far worse — hand a Suppliers lead
 * a theme camp's medical notes. Naming the domain is the whole enforcement.
 */
export function canReadPersonalInformationIn(
  actor: OrgActor | null | undefined,
  domain: OrgDomain,
): boolean {
  return orgCanInDomain(actor, "personal_information", domain);
}

/**
 * Does this actor read personal information ANYWHERE? For affordances only — a
 * nav entry, a search placeholder, a page-level "you will not see emails here"
 * note. NEVER for deciding what a query selects: an actor who reads personal
 * information in Suppliers answers true here and must still be refused a theme
 * camp's members.
 *
 * Deliberately renamed from `canReadPersonalInformation` when the capability
 * became scoped, so that every existing call site had to be revisited rather
 * than silently keeping the global meaning it no longer has.
 */
export function canReadPersonalInformationAnywhere(
  actor: OrgActor | null | undefined,
): boolean {
  return orgCan(actor, "personal_information");
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
  /**
   * For a scoped grant, THE PARTS OF THE CONSOLE IT ACTUALLY REACHES — the union
   * of the domains those departments own. `null` when the grant is org-wide.
   *
   * An EMPTY array is the case worth having this field for: a role scoped to a
   * department that owns nothing looks like a grant and is not one. Reporting
   * "can delete, in Safety only" without saying Safety owns nothing would be a
   * summary that overstates access to the exact person deciding whether the
   * access is acceptable.
   */
  domains: OrgDomain[] | null;
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
 * `delete` and `read_personal_information` and nothing else
 * (`DEPARTMENT_SCOPED_CAPABILITIES`), so a "Suppliers member" whose role grants
 * `read` reads the WHOLE console — `requireOrgSession` resolves unscoped
 * capabilities through `orgCan`, which does not look at the department at all.
 * Reporting "reads, in Suppliers only" would be a smaller claim than the truth,
 * and a summary that under-states access is as dangerous as one that over-states
 * it: it is read by the person deciding whether the grant is acceptable.
 *
 * An ENGINEER is summarised through the same resolver, so their two carve-outs
 * simply do not appear however their roles are written, and nothing they do hold
 * is reported as confined to a department (their reach is all of them).
 */
export function summarizeOrgActor(
  actor: OrgActor | null | undefined,
): OrgCapabilityGrant[] {
  if (!actor) return [];
  return ORG_CAPABILITIES.filter((c) => orgCan(actor, c)).map((capability) => {
    const scoped =
      isDepartmentScopedCapability(capability) &&
      isDepartmentScopedGrant(actor, capability);
    if (!scoped) {
      return { capability, departmentIds: null, domains: null };
    }
    const departmentIds = departmentsGranting(actor, capability);
    const domains = new Set<OrgDomain>();
    for (const id of departmentIds) {
      for (const d of domainsOwnedBy(actor.domains, id)) domains.add(d);
    }
    return { capability, departmentIds, domains: [...domains] };
  });
}

/**
 * One line for a resolved grant's scope, safe to put in front of a reviewer:
 * "everywhere", the domains it reaches, or the honest warning that it reaches
 * nothing. Lives here so the accounts table, the assignment preview and the role
 * editor cannot phrase the same fact three ways.
 */
export function grantScopeClause(
  grant: Pick<OrgCapabilityGrant, "domains">,
  departmentNames: readonly string[],
): string {
  if (grant.domains === null) return "everywhere";
  const where =
    departmentNames.length === 0
      ? "a department"
      : departmentNames.length === 1
        ? (departmentNames[0] as string)
        : `${departmentNames.slice(0, -1).join(", ")} and ${departmentNames[departmentNames.length - 1]}`;
  if (grant.domains.length === 0) {
    return `in ${where} only — which owns no part of the console, so this reaches nothing`;
  }
  return `in ${where} only: ${listDomainLabels(grant.domains)}`;
}

/** The capability keys a permissions object grants, in vocabulary order. */
export function grantedOrgCapabilities(
  permissions: OrgPermissions | null | undefined,
): OrgCapability[] {
  if (!permissions) return [];
  return ORG_CAPABILITIES.filter((c) => permissions[c] === true);
}

// WHAT A DEPARTMENT OWNS — the missing half of department scoping.
//
// Ryan, 27 Jul 2026: "supplier leads would be able to read the PII of anything
// supply-related." The operative word is RELATED. A Suppliers lead's authority
// is not over a list of rows somebody remembered to tag; it is over a SUBJECT
// AREA — suppliers, their documents, the people attached to them. So a
// department owns a set of DOMAIN KEYS, and an entity's department is whichever
// department owns the domain that entity lives in.
//
// ## WHY NOT A `department_id` COLUMN ON EVERY TABLE
//
// Because it would be wrong in three ways at once. It would need a migration on
// nine tables and a backfill that guesses; every insert path would have to
// remember to set it, and the one that forgot would silently produce an unfiled
// row that only an org-wide role could touch; and it would let two suppliers
// belong to different departments, which is not a thing AfrikaBurn has ever
// said it wants. "Anything supply-related" is one answer for a whole area, and
// one row in one table is the honest shape of one answer.
//
// ## WHAT IS HARDCODED HERE, AND WHAT IS NOT
//
// The DEPARTMENTS are still data — a System manager creates them, and nothing
// in this repo names one. What is hardcoded is the list of domains the console
// DEMONSTRABLY HAS, because that list is not the org's to invent: it is a fact
// about the code. Every key below names surfaces that exist today, and the
// comment on each says which — if a key here cannot be traced to a route and a
// query, it is an aspiration and does not belong.
//
// Adding a console area later means adding a key here, giving it a label, and
// pointing its queries and guards at it. Nothing in the database has to move: a
// domain nobody has assigned is simply unowned, which fails closed.
//
// ## SOME DOMAINS ARE INERT TODAY, AND THE COPY SAYS SO
//
// A domain only CHANGES anything where a department-scoped capability is asked
// for it. Today that is `read_personal_information` (accounts, registrations,
// suppliers, questionnaires, audit) and `delete` (suppliers, supplier
// documents). `bulletins` and `camp_categories` carry neither — no personal
// column, no destructive guard — so owning them is inert.
//
// They stay in the vocabulary because they are real console areas and a
// half-drawn org chart is its own confusion, but the description of each SAYS
// it is inert. A checkbox that reads as access and grants none is the exact trap
// this whole change was written to remove; it would be absurd to reintroduce it
// one screen later.
//
// ## UNOWNED IS A REAL STATE AND IT FAILS CLOSED
//
// A domain no department owns belongs to no department, so `orgCanIn` resolves
// it as unfiled and only an ORG-WIDE role reaches it. That is deliberate: the
// first day after this ships, nothing is assigned, and a Suppliers lead should
// then delete nothing rather than everything. The console says so out loud
// (`departmentDomainsNote`) instead of letting someone find out by being refused
// in front of a colleague.

/**
 * THE CONSOLE'S SUBJECT AREAS, in the order a System manager reads them.
 *
 * Derived from the routes and guards that exist in apps/org today, not from a
 * taxonomy of what AfrikaBurn does. Deliberately absent:
 *
 *   · `notifications` — `/notifications` is the signed-in actor's OWN inbox.
 *     There is nobody else's to scope, and its two actions are the documented
 *     "acting on themselves" bare gates.
 *   · `system`        — `/system` is gated on `read_system`, which is a rank
 *     concern (who runs the deployment), not a departmental one. The people
 *     list ON that page is the `accounts` domain, and asks for it.
 *   · `status`        — the status board is derived counts over everything else.
 *     Scoping a rollup would mean scoping every number in it separately, and a
 *     count of camps is not personal or destructible.
 */
export const ORG_DOMAINS = [
  "registrations",
  "suppliers",
  "supplier_documents",
  "questionnaires",
  "bulletins",
  "camp_categories",
  "accounts",
  "audit",
] as const;

export type OrgDomain = (typeof ORG_DOMAINS)[number];

const ORG_DOMAIN_SET: ReadonlySet<string> = new Set(ORG_DOMAINS);

/** True when a stored string is a domain this build knows. Unknown keys are
 * ignored everywhere rather than trusted — a row left behind by a removed
 * console area must not resolve to an ownership nobody can see or edit. */
export function isOrgDomain(value: string): value is OrgDomain {
  return ORG_DOMAIN_SET.has(value);
}

/** The chip / checkbox heading. Two or three words, the console's own nouns. */
export const ORG_DOMAIN_LABELS: Record<OrgDomain, string> = {
  registrations: "Theme camps and registrations",
  suppliers: "Suppliers",
  supplier_documents: "Supplier documents",
  questionnaires: "Questionnaires",
  bulletins: "Bulletins",
  camp_categories: "Camp categories",
  accounts: "Accounts and org access",
  audit: "Audit log",
};

/**
 * WHAT EACH DOMAIN ACTUALLY COVERS — the routes and the guards, named. This is
 * the sentence under the checkbox when a System manager gives a domain to a
 * department, and it is written against the code rather than the org chart, so
 * that "give Suppliers to the supply team" is an informed decision about who
 * can then read a phone number and destroy a row.
 */
export const ORG_DOMAIN_DESCRIPTIONS: Record<OrgDomain, string> = {
  registrations:
    "Camp, artwork and vehicle registrations: the review screens, the review threads, a camp's officers and its members' details — including the medical notes on a member's page.",
  suppliers:
    "The supplier repository: standing, onboarding, org-internal notes, the sign-up queue, and deleting a supplier outright.",
  supplier_documents:
    "The documents suppliers must read and acknowledge, and withdrawing one (which discards its acknowledgements).",
  questionnaires:
    "Org questionnaires: the builder, activations, and the per-person results — which are named people's answers.",
  bulletins:
    "The notices every camp lead sees, drafted and published here. Nothing here is personal or destructible today, so owning it does not change what anyone can do yet — it is here so the org chart can be complete, and it binds the day either appears.",
  camp_categories:
    "The per-edition category taxonomy every camp is filed under, and re-filing camps between them. Managing the taxonomy is the System manager's, so owning this does not change what anyone can do yet — it is here so the org chart can be complete.",
  accounts:
    "The accounts screen and the org-access roster in the system panel: who can open the console, and their email addresses.",
  audit:
    "The audit log, including the record of who read whose medical notes — a list that names the burners who have disclosed a health condition.",
};

/** A department, as the resolution map holds it: the id a grant is matched on,
 * and the name a refusal is allowed to say out loud. */
export interface DomainOwner {
  id: string;
  name: string;
}

/**
 * WHICH DEPARTMENT OWNS EACH DOMAIN — resolved once per request from
 * `org_department_domains` and carried on the actor.
 *
 * It rides on `OrgActor` rather than being threaded through forty call sites
 * because it is the CONTEXT every scoped question needs and the one a caller
 * would forget. A missing key means unowned, which is the fail-closed answer.
 */
export type DomainOwnership = Readonly<Partial<Record<OrgDomain, DomainOwner>>>;

/** Nothing is filed anywhere — the honest default for a fresh deployment, and
 * the right value wherever a surface asks no domain question at all. */
export const NO_DOMAIN_OWNERSHIP: DomainOwnership = Object.freeze({});

/**
 * Build the map from stored rows, dropping any domain key this build does not
 * know and keeping the FIRST owner of a domain if a row set somehow carries two
 * (the primary key on `domain` makes that impossible in the database; this
 * makes it impossible in memory too, rather than order-dependent).
 */
export function buildDomainOwnership(
  rows: readonly {
    domain: string;
    departmentId: string;
    departmentName: string;
  }[],
): DomainOwnership {
  const out: Partial<Record<OrgDomain, DomainOwner>> = {};
  for (const row of rows) {
    if (!isOrgDomain(row.domain)) continue;
    if (out[row.domain]) continue;
    out[row.domain] = { id: row.departmentId, name: row.departmentName };
  }
  return out;
}

/** The department that owns a domain, or null when nobody does. */
export function departmentOwning(
  ownership: DomainOwnership | null | undefined,
  domain: OrgDomain | null | undefined,
): DomainOwner | null {
  if (!ownership || !domain) return null;
  return ownership[domain] ?? null;
}

/** The owning department's ID — what `orgCanIn` matches a role's scope against. */
export function departmentForDomain(
  ownership: DomainOwnership | null | undefined,
  domain: OrgDomain | null | undefined,
): string | null {
  return departmentOwning(ownership, domain)?.id ?? null;
}

/** The domains one department owns, in vocabulary order. Empty means a role
 * scoped to it reaches nothing at all — a fact the console must state. */
export function domainsOwnedBy(
  ownership: DomainOwnership | null | undefined,
  departmentId: string | null | undefined,
): OrgDomain[] {
  if (!ownership || !departmentId) return [];
  return ORG_DOMAINS.filter((d) => ownership[d]?.id === departmentId);
}

/** The domains no department owns — only an org-wide role reaches these. */
export function unownedDomains(
  ownership: DomainOwnership | null | undefined,
): OrgDomain[] {
  return ORG_DOMAINS.filter((d) => !ownership?.[d]);
}

/** Human list: "suppliers, supplier documents and questionnaires". */
export function listDomainLabels(domains: readonly OrgDomain[]): string {
  const labels = domains.map((d) => ORG_DOMAIN_LABELS[d].toLowerCase());
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * WHAT A ROLE SCOPED TO THIS DEPARTMENT ACTUALLY REACHES, said out loud wherever
 * a scoped grant is offered or displayed.
 *
 * This replaced a flat constant that claimed nothing was ever filed under a
 * department. That claim was true when nothing could be, and became a lie the
 * moment domains existed — so the copy is computed from the assignment instead
 * of asserted, and the "owns nothing" case keeps the warning it deserves.
 */
export function departmentDomainsNote(domains: readonly OrgDomain[]): string {
  if (domains.length === 0) {
    return "This department owns no part of the console yet, so a role scoped to it reaches nothing at all — give it something below, or use an org-wide role.";
  }
  return `Reaches ${listDomainLabels(domains)} — and nothing else in the console.`;
}

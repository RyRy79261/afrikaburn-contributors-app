// Org departments + org roles — the DATA a System manager creates, and the rows
// the console seeds on their behalf. Pure logic only (no DB): normalization is
// the uniqueness key stored in `org_departments.name_normalized` /
// `org_roles.name_normalized`, and the row builders below produce inserts the
// caller persists.
//
// This is the ORG SIDE of `project-roles.ts`, written to the same shape on
// purpose (Ryan asked for the camp pattern, not a second vocabulary):
//
//     project_roles : groups        ::  org_roles : org_departments
//     ProjectRoleKind (5 kinds)     ::  OrgRoleKind (2: system | custom)
//     UNDELETABLE_ROLE_KINDS        ::  UNDELETABLE_ORG_ROLE_KINDS
//     ProjectPermissions (jsonb)    ::  OrgPermissions (jsonb)
//
// ## The two kinds, and what "permanent" means
//
// `system` roles are SEEDED and UNDELETABLE, and their RIGHTS ARE EDITABLE. That
// is Ryan's "set permanent ones… these cant be removed but they can have the
// rights edited", and it is the point of the whole change: the rules that used
// to be hardcoded law are now the DEFAULTS of a row.
//
// Three consequences a reader should not have to discover:
//
//   1. A System manager CAN grant `read_personal_information` to the Engineer
//      ROLE — and it will do nothing for an account whose RANK is engineer.
//      (Amended 27 Jul 2026.) The rank carve-out became a ceiling when the
//      engineer's REACH became universal: `ENGINEER_RANK_CARVE_OUTS` in
//      `org-permissions.ts` refuses personal information and deletion to that
//      rank however its roles are written, because "in every department" plus
//      "can read anyone's details" is one role assignment away from all of it at
//      once. The role row still means what it says for an ORG_STAFF account
//      holding it. The hard privacy floors are unchanged: medical stays
//      encrypted, stays out of every public projection, stays off lists and
//      exports, and every disclosing read is still audited.
//   2. Deleting a department deletes its LEAD and MEMBER roles (FK cascade), and
//      every assignment of them. They exist to express that department; without
//      it they express nothing.
//   3. A department's roles are only half of a scope. WHAT the department owns
//      — its DOMAIN KEYS (`org-domains.ts`, `org_department_domains`) — is the
//      other half, and a department that owns nothing makes every role scoped to
//      it grant nothing at all. The console says so; do not treat it as a bug.

import type {
  OrgDepartmentKind,
  OrgPermissions,
  OrgRoleKind,
  RoleColor,
} from "@quagga/types";
import { normalizeName } from "./name-dedupe";

/** Max length of a department label. */
export const ORG_DEPARTMENT_NAME_MAX = 60;

/** Max length of an org role label. */
export const ORG_ROLE_NAME_MAX = 60;

/** Cap on departments — a guard rail against a runaway form, not a policy. */
export const ORG_DEPARTMENT_CAP = 40;

/** Cap on org roles (seeded + custom together). */
export const ORG_ROLE_CAP = 60;

/**
 * Canonical uniqueness key for a department or role name — case/space/punct-
 * insensitive, the same normalizer camp names and project roles use. "Theme
 * Camps", "theme-camps" and "themecamps" all collapse to one key and so collide
 * on the unique index.
 */
export function normalizeOrgName(name: string): string {
  return normalizeName(name);
}

/** Trimmed, whitespace-collapsed display form. */
export function cleanOrgName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Validity of a candidate department label. */
export function isValidDepartmentName(name: string): boolean {
  const cleaned = cleanOrgName(name);
  return (
    cleaned.length > 0 &&
    cleaned.length <= ORG_DEPARTMENT_NAME_MAX &&
    normalizeOrgName(cleaned).length > 0
  );
}

/** Validity of a candidate org role label. */
export function isValidOrgRoleName(name: string): boolean {
  const cleaned = cleanOrgName(name);
  return (
    cleaned.length > 0 &&
    cleaned.length <= ORG_ROLE_NAME_MAX &&
    normalizeOrgName(cleaned).length > 0
  );
}

/**
 * True when `candidate` collides (normalized) with any existing name.
 * `exceptNormalized` skips one existing key so renaming a row to a pure
 * case/punctuation variant of its own name does not self-conflict.
 */
export function orgNameConflicts(
  existingNames: readonly string[],
  candidate: string,
  exceptNormalized?: string,
): boolean {
  const key = normalizeOrgName(candidate);
  return existingNames.some((n) => {
    const existingKey = normalizeOrgName(n);
    if (exceptNormalized !== undefined && existingKey === exceptNormalized) {
      return false;
    }
    return existingKey === key;
  });
}

/**
 * The stable slug stored on `org_departments.key`, derived ONCE at creation and
 * never rewritten by a rename — the seeded role keys are built from it, and a
 * key that moved with the label would not be a key.
 */
export function departmentKeyFrom(name: string): string {
  const slug = cleanOrgName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "department";
}

/** Disambiguate a department key against ones already taken (`suppliers_2`). */
export function uniqueDepartmentKey(
  base: string,
  taken: readonly string[],
): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** The two slots every department gets, in display order. */
export const DEPARTMENT_ROLE_SLOTS = ["lead", "member"] as const;
export type DepartmentRoleSlot = (typeof DEPARTMENT_ROLE_SLOTS)[number];

/** The stable role key for a department's seeded lead/member role. */
export function departmentRoleKey(
  departmentKey: string,
  slot: DepartmentRoleSlot,
): string {
  return `dept.${departmentKey}.${slot}`;
}

/** The key of a System-manager-created custom role. */
export function customOrgRoleKey(
  name: string,
  taken: readonly string[],
): string {
  const base = `custom.${departmentKeyFrom(name)}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** True when a role kind may be deleted (only `custom`). */
export function canDeleteOrgRoleKind(kind: OrgRoleKind): boolean {
  return kind === "custom";
}

/**
 * True when a DEPARTMENT may be deleted — `custom` only, exactly as roles work.
 *
 * Theme camps and Suppliers are seeded `system` (migration 0022) because each
 * backs a deployed portal: a console that can delete "Suppliers" is a console
 * that can orphan apps/suppliers, its documents, its onboarding and its whole
 * audience. Their NAME, DESCRIPTION, RIGHTS and DOMAINS all stay editable —
 * "cannot be removed" is not "cannot be changed".
 */
export function canDeleteOrgDepartmentKind(kind: OrgDepartmentKind): boolean {
  return kind === "custom";
}

/** True when a role kind may be renamed — both; the key is the stable anchor. */
export function canRenameOrgRoleKind(_kind: OrgRoleKind): boolean {
  return true;
}

/**
 * True when a role kind's PERMISSIONS may be edited. Both kinds: "permanent" is
 * about the row's existence, never about its rights. Written as a function
 * anyway so a future locked kind has one place to land, exactly like
 * `isPermissionsLockedKind` on the camp side.
 */
export function canEditOrgRolePermissions(_kind: OrgRoleKind): boolean {
  return true;
}

/** True when a role's DEPARTMENT may be changed. Seeded department roles are
 * bound to the department that created them; everything else is free. */
export function canRescopeOrgRole(role: {
  kind: OrgRoleKind;
  departmentId: string | null;
}): boolean {
  return !(role.kind === "system" && role.departmentId !== null);
}

/** A DB-ready `org_roles` insert row. */
export interface OrgRoleInsert {
  key: string;
  departmentId: string | null;
  name: string;
  nameNormalized: string;
  description: string | null;
  kind: OrgRoleKind;
  color: RoleColor;
  permissions: OrgPermissions;
  sort: number;
}

/** A seeded org role's authoring metadata. */
export interface SeededOrgRole {
  key: string;
  name: string;
  description: string;
  color: RoleColor;
  sort: number;
  permissions: OrgPermissions;
}

/**
 * THE TWO MIGRATED RANKS, carrying EXACTLY the rights they held as hardcoded
 * ranks on 27 Jul 2026 — nothing widened, nothing narrowed, so the change of
 * mechanism is not also a change of access:
 *
 *   Org staff — read, read_personal_information, write, delete
 *   Engineer  — read, write, read_system   (NO personal information, NO delete)
 *
 * These are now DEFAULTS OF A ROW rather than law. A System manager may edit
 * either, including granting the Engineer role personal-information access.
 * `manage_camp_categories` and `manage_accounts` were the System manager's and
 * stay unassigned here — the first is grantable if the org wants it, the second
 * is not grantable at all (@quagga/core `org-permissions`).
 */
/**
 * THE DEPARTMENTS THAT CANNOT BE MISSING, and the domains each answers for.
 *
 * Each backs a deployed portal — apps/web's registration pipeline and
 * apps/suppliers — so a console where they can go missing is a console that can
 * orphan an application. Seeded `system` (migration 0022), undeletable, and
 * everything else about them stays editable.
 *
 * Deliberately only TWO. Ryan, 27 Jul 2026: "there is a team lead for each
 * department, we dont know how many departements there are, or what protocols
 * they have so lets not over complicate it" — so Safety, Rangers, MOOP and the
 * rest stay `custom` departments a System manager creates, and the vocabulary
 * does not pretend to know them.
 */
export const SEEDED_ORG_DEPARTMENTS = [
  {
    key: "theme_camps",
    name: "Theme camps",
    description:
      "Camp, artwork and vehicle registrations — the review pipeline behind the participant app.",
    domains: ["registrations", "camp_categories"],
    sort: 0,
  },
  {
    key: "suppliers",
    name: "Suppliers",
    description:
      "The supplier repository and the documents suppliers acknowledge — the org side of the supplier portal.",
    domains: ["suppliers", "supplier_documents"],
    sort: 1,
  },
] as const;

export const SEEDED_ORG_ROLES: readonly SeededOrgRole[] = [
  {
    key: "org_staff",
    name: "Org staff",
    description:
      "Reviews registrations, vets suppliers and sees members' details.",
    color: "apricot",
    sort: 0,
    permissions: {
      create: true,
      read: true,
      update: true,
      delete: true,
      personal_information: true,
    },
  },
  {
    key: "engineer",
    name: "Engineer",
    description:
      "Runs the system: full read access and the system panel, no personal information, nothing destructive.",
    color: "teal",
    sort: 1,
    // No `personal_information`, no `delete` — the two rank carve-outs, stated
    // here as defaults too so the row a System manager reads matches the rank
    // ceiling that enforces it. `read_system` is gone: opening the system panel
    // is the System manager rank, not a grant.
    permissions: { create: true, read: true, update: true },
  },
];

/** The seeded org-wide role rows, ready to upsert on `key`. */
export function seededOrgRoleRows(): OrgRoleInsert[] {
  return SEEDED_ORG_ROLES.map((r) => ({
    key: r.key,
    departmentId: null,
    name: r.name,
    nameNormalized: normalizeOrgName(r.name),
    description: r.description,
    kind: "system" as OrgRoleKind,
    color: r.color,
    permissions: r.permissions,
    sort: r.sort,
  }));
}

/**
 * The DEFAULT rights of a department's two seeded roles.
 *
 * A department LEAD answers for their domain: they read it, INCLUDING PEOPLE'S
 * DETAILS, they do the work, and they may delete — and because the role is
 * department-scoped, BOTH sharp capabilities are confined to the domains that
 * department OWNS (`orgCanInDomain`). That is Ryan's rule in full, 27 Jul 2026:
 * "supplier leads would be able to read the PII of anything supply-related" —
 * and, by the same sentence, of nothing else. A scoped role PLUS a domain
 * assignment, not a hardcoded domain→department map.
 *
 * Read that pairing before changing this row: on its own, `read_personal_
 * information` here is a real grant over real burners' contact details and
 * medical notes, and the only thing keeping it proportionate is the department's
 * domain list. A department that owns everything has a lead who reads everyone.
 *
 * A department MEMBER reads and does ordinary work, sees no personal
 * information, and deletes nothing.
 *
 * Both are defaults on a row a System manager may edit — which is the point.
 */
export const DEPARTMENT_LEAD_PERMISSIONS: OrgPermissions = {
  create: true,
  read: true,
  update: true,
  delete: true,
  personal_information: true,
};

export const DEPARTMENT_MEMBER_PERMISSIONS: OrgPermissions = {
  create: true,
  read: true,
  update: true,
};

/** The display label for a department's seeded role. */
export function departmentRoleName(
  departmentName: string,
  slot: DepartmentRoleSlot,
): string {
  return `${cleanOrgName(departmentName)} ${slot}`;
}

/**
 * The LEAD + MEMBER rows seeded when a department is created. `system` kind, so
 * they cannot be deleted while the department exists — and they cascade away
 * with it.
 */
export function departmentRoleRows(department: {
  id: string;
  key: string;
  name: string;
}): OrgRoleInsert[] {
  return DEPARTMENT_ROLE_SLOTS.map((slot, i) => {
    const name = departmentRoleName(department.name, slot);
    return {
      key: departmentRoleKey(department.key, slot),
      departmentId: department.id,
      name,
      nameNormalized: normalizeOrgName(name),
      description:
        slot === "lead"
          ? `Answers for ${cleanOrgName(department.name)}. Ordinary work plus deletion, confined to this department.`
          : `Works in ${cleanOrgName(department.name)}. Reads and makes ordinary changes.`,
      kind: "system" as OrgRoleKind,
      color: (slot === "lead" ? "olive" : "sage") as RoleColor,
      permissions:
        slot === "lead"
          ? DEPARTMENT_LEAD_PERMISSIONS
          : DEPARTMENT_MEMBER_PERMISSIONS,
      sort: 100 + i,
    };
  });
}

/**
 * The role a newly-granted console account gets by default, by the door they
 * came in through. Assigning it is what stops "elevate to org staff" producing
 * an account that can load the console and do nothing — the fail-closed
 * behaviour is correct but is a bad first experience when nobody asked for it.
 * A System manager can change the assignment immediately afterwards.
 */
export function defaultRoleKeyForRank(rank: "org_staff" | "engineer"): string {
  return rank;
}

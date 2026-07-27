import { z } from "zod";

/**
 * Membership role ladder, recorded on `memberships.role` (one row per
 * user × group). Roles are scoped to a group — a burner can hold `member` on
 * one camp and `lead` on another, and an org rank on the single seeded
 * AfrikaBurn org group.
 *
 * - `god`       — the highest org rank, PRESENTED EVERYWHERE AS "System
 *                 manager" (see below); ONLY valid on the org group.
 *                 Bootstrapped from the `GOD_EMAILS` env list on first login.
 * - `org_staff` — an AfrikaBurn org account (org group only).
 * - `engineer`  — an AfrikaBurn org account created through the IT path (org
 *                 group only).
 * - `lead`      — a project's leader; can manage invites + registration.
 * - `admin`     — a project co-organiser below the lead.
 * - `member`    — a plain member of a group.
 *
 * **ON THE ORG GROUP, THIS ENUM IS THE DOOR — NOT THE RIGHTS.** Since org roles
 * v1 (migration 0018) `org_staff` and `engineer` mean exactly one thing: *this
 * account may load the console*. WHAT they may then read and do comes from the
 * ORG ROLES they hold (`org_roles` + `org_role_assignments`), which a System
 * manager creates, edits and assigns — see @quagga/core `org-permissions`
 * (`orgCan`) and `org-roles`. `god` is the one exception and the anti-lockout
 * anchor: a god IS the System manager and resolves every capability whatever any
 * role row says, so no edit to a table can define the System manager out of
 * existence.
 *
 * **`god` IS "System manager" — do not "fix" this.** The rank Ryan calls the
 * System manager is STORED as `god` on purpose. Renaming the enum value would
 * mean migrating every live row, re-cutting the GOD_EMAILS bootstrap (which
 * writes the literal `god`), and touching every god-persona e2e spec — all for
 * a label. So the storage keeps `god` and the UI reads
 * `ORG_RANK_LABELS` (@quagga/core `org-permissions`), which maps
 * `god → "System manager"`. If you came here to make the names agree: the
 * inconsistency is deliberate, and the label layer is the place to change.
 *
 * Keep this tuple in sync with `membershipRoleEnum` in @quagga/db schema.ts —
 * the database is the storage authority; this is the validation authority.
 * Both are APPEND-ONLY (a Postgres enum value cannot be reordered or removed
 * without rewriting the type), which is why `engineer` sits at the end rather
 * than in rank order.
 */
export const MembershipRole = z.enum([
  "god",
  "org_staff",
  "lead",
  "admin",
  "member",
  "engineer",
]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/**
 * Roles that may enter the org/admin app (`apps/org`). Clearing this gate only
 * gets you THROUGH the door — what you may then read and write is decided by
 * the capability matrix in @quagga/core `org-permissions`, which both the gate
 * and the console UI read so a hidden button and a refused action can never
 * disagree.
 */
export const ORG_APP_ROLES: readonly MembershipRole[] = [
  "god",
  "org_staff",
  "engineer",
];

/** Roles that may administer a project group (invites, registration, members). */
export const PROJECT_ADMIN_ROLES: readonly MembershipRole[] = ["lead", "admin"];

// --- Org roles v1 (migration 0018) ----------------------------------------
// The org side of the SAME idea the camp side already solved in Roles v2 below:
// a role row carries a key, a label, a KIND that encodes permanence, and a
// `permissions` JSONB object. One vocabulary, two scopes — read `ProjectRoleKind`
// / `UNDELETABLE_ROLE_KINDS` further down and the shapes will look familiar,
// because they are deliberately the same shapes.
//
// Ryan, 27 Jul 2026: "system admins can simply have a roles management section
// and create n sign these things instead of needing to hardcode them? With some
// set permanent ones, like team leads and team members for each department
// domain, these cant be removed but they can have the rights edited."

/**
 * An org role's kind — permanence, exactly as `ProjectRoleKind` does it:
 *
 * - `system` — SEEDED and UNDELETABLE, rights EDITABLE. Ryan's "set permanent
 *   ones": the two migrated ranks (Org staff, Engineer) and the LEAD + MEMBER
 *   pair every department gets when a System manager creates it. A department's
 *   two roles live and die with the department (FK cascade).
 * - `custom` — a System manager creates, renames, re-scopes, re-rights and
 *   deletes these freely.
 *
 * Only `custom` may be deleted. BOTH may be renamed and BOTH may have their
 * permissions edited — "cannot be removed" is not "cannot be changed", and the
 * editable rights are the whole point of the change.
 */
export const OrgRoleKind = z.enum(["system", "custom"]);
export type OrgRoleKind = z.infer<typeof OrgRoleKind>;

/** Org role kinds that may NOT be deleted. Only `custom` deletes. */
export const UNDELETABLE_ORG_ROLE_KINDS: readonly OrgRoleKind[] = ["system"];

/** Org role kinds that may be renamed — both; the `key` is the stable anchor. */
export const RENAMEABLE_ORG_ROLE_KINDS: readonly OrgRoleKind[] = [
  "system",
  "custom",
];

/**
 * The console capability vocabulary — the STORAGE + VALIDATION authority for the
 * keys inside `org_roles.permissions`. @quagga/core `org-permissions` re-exports
 * this tuple as `ORG_CAPABILITIES` and is where each key's meaning is written
 * down; this package holds it only because `@quagga/db`'s schema needs the type
 * and core must never be imported by the schema.
 *
 * APPEND-ONLY in spirit: a stored permissions object may name any of these keys,
 * so removing one strands data. Add to the end.
 */
export const OrgCapabilityKey = z.enum([
  "read",
  "read_personal_information",
  "write",
  "delete",
  "manage_camp_categories",
  "manage_accounts",
  "read_system",
]);
export type OrgCapabilityKey = z.infer<typeof OrgCapabilityKey>;

export const ORG_CAPABILITY_KEYS = OrgCapabilityKey.options;

/**
 * The permissions OBJECT stored on `org_roles.permissions` (jsonb) — the same
 * present-and-true shape as `ProjectPermissions`. An absent key is NOT a grant:
 * resolution is fail-closed, so `{}` is a role that can do nothing.
 */
export const OrgPermissions = z.object({
  read: z.boolean().optional(),
  read_personal_information: z.boolean().optional(),
  write: z.boolean().optional(),
  delete: z.boolean().optional(),
  manage_camp_categories: z.boolean().optional(),
  manage_accounts: z.boolean().optional(),
  read_system: z.boolean().optional(),
});
export type OrgPermissions = z.infer<typeof OrgPermissions>;

// --- Roles v2: kinds, colors, permissions (questionnaire-spec §"Roles v2") ---
// Custom project roles carry a KIND (permanence + assignment semantics), a
// COLOR (curated palette key, token-mapped at render), an emoji, and a
// PERMISSIONS object. Keep these tuples in sync with the DB enums in
// @quagga/db schema.ts — the DB is the storage authority, this the validation
// authority.

/**
 * A project role's kind (questionnaire-spec §"Role kinds"):
 * - `captain`  — seeded Captain 🎩; permissions LOCKED to all; not deletable.
 * - `baseline` — seeded Burner 🔥; every member implicitly holds it (derived,
 *                never stored per-member); not deletable; permissions editable.
 * - `default`  — seeded Team lead 🔧; normal role, not deletable.
 * - `custom`   — user-created; fully editable + deletable (cascade).
 * - `officer`  — org-defined catalog role (LNT Lead, Sound Officer, …); not
 *                aliasable; assignment is a consent flow; not deletable by camp.
 */
export const ProjectRoleKind = z.enum([
  "captain",
  "baseline",
  "default",
  "custom",
  "officer",
]);
export type ProjectRoleKind = z.infer<typeof ProjectRoleKind>;

/** Role kinds a camp may NOT delete (permanent fixtures). Only `custom` deletes. */
export const UNDELETABLE_ROLE_KINDS: readonly ProjectRoleKind[] = [
  "captain",
  "baseline",
  "default",
  "officer",
];

/** Role kinds a camp may rename (alias). Officers are org-uniform: never. */
export const RENAMEABLE_ROLE_KINDS: readonly ProjectRoleKind[] = [
  "captain",
  "baseline",
  "default",
  "custom",
];

/**
 * Curated color palette keys derived from the brand ramp (build-spec §UI). NOT
 * freeform hex — token-mapped at render so both themes stay legible.
 */
export const RoleColor = z.enum([
  "teal",
  "teal_deep",
  "apricot",
  "peach",
  "sage",
  "olive",
  "rust",
  "neutral",
]);
export type RoleColor = z.infer<typeof RoleColor>;

export const ROLE_COLORS = RoleColor.options;

/**
 * Project permission keys (questionnaire-spec §"Roles v2" privileges table).
 * `manage_roles` implies `assign_roles`.
 */
export const ProjectPermissionKey = z.enum([
  "view_member_details",
  "manage_questionnaires",
  "assign_roles",
  "manage_roles",
  "manage_members",
]);
export type ProjectPermissionKey = z.infer<typeof ProjectPermissionKey>;

export const PROJECT_PERMISSION_KEYS = ProjectPermissionKey.options;

/**
 * Config for `manage_questionnaires` (the only privilege with sub-controls):
 * which role audiences the holder may target, and whether they may send
 * BLOCKING questionnaires. `audienceRoles: "all"` = any audience; otherwise the
 * explicit set of project_role ids they may target. `"everyone"` (baseline)
 * counts as targeting the baseline role id.
 */
export const ManageQuestionnairesScope = z.object({
  audienceRoles: z.union([z.literal("all"), z.array(z.string().min(1))]),
  mayBlock: z.boolean(),
});
export type ManageQuestionnairesScope = z.infer<
  typeof ManageQuestionnairesScope
>;

/**
 * The permissions OBJECT stored on `project_roles.permissions` (jsonb). Each
 * boolean privilege is present+true when granted; `manage_questionnaires` holds
 * its scope config when granted (absent = not granted).
 */
export const ProjectPermissions = z.object({
  view_member_details: z.boolean().optional(),
  manage_questionnaires: ManageQuestionnairesScope.optional(),
  assign_roles: z.boolean().optional(),
  manage_roles: z.boolean().optional(),
  manage_members: z.boolean().optional(),
});
export type ProjectPermissions = z.infer<typeof ProjectPermissions>;

/** Human labels for the privilege toggles (settings editor copy). */
export const PROJECT_PERMISSION_LABELS: Record<ProjectPermissionKey, string> = {
  view_member_details: "See member details",
  manage_questionnaires: "Send questionnaires",
  assign_roles: "Assign roles",
  manage_roles: "Manage roles",
  manage_members: "Manage members",
};

// --- Officer catalog (questionnaire-spec §"Officer roles") -----------------
// Org-defined, condition-triggered roles with a STABLE key (the org targeting
// anchor). Camps may not alias them. Display name/emoji/color are fixed here.

export const OfficerKey = z.enum([
  "lnt_officer",
  "safety_officer",
  "fire_safety_officer",
  "sound_officer",
  "safety_monitor",
]);
export type OfficerKey = z.infer<typeof OfficerKey>;

export const OFFICER_KEYS = OfficerKey.options;

/**
 * Consent state of an officer assignment (questionnaire-spec §"Officers are ALSO
 * registrations"). Assigning creates a `pending` state the member must ACCEPT
 * (sharing contact details with the org) or DECLINE. Non-officer role
 * assignments are always `accepted` (no consent moment).
 */
export const RoleAssignmentConsent = z.enum(["pending", "accepted", "declined"]);
export type RoleAssignmentConsent = z.infer<typeof RoleAssignmentConsent>;

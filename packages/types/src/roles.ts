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
 * - `org_staff` — AfrikaBurn reviewers/coordinators (org group only).
 * - `engineer`  — IT/engineering rank (org group only): reads everywhere, sees
 *                 NO personal information, and cannot delete anything. The
 *                 capability matrix lives in @quagga/core `org-permissions`.
 * - `lead`      — a project's leader; can manage invites + registration.
 * - `admin`     — a project co-organiser below the lead.
 * - `member`    — a plain member of a group.
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

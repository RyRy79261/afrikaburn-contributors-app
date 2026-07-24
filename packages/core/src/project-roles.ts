// Custom per-project roles (questionnaire-spec §"Custom project roles"). These
// are labels — used for organisation + questionnaire audiences — and are
// SEPARATE from the structural `memberships.role` ladder (god/org_staff/lead/
// admin/member), which governs permissions. Defaults are seeded on project
// creation; leads/admins add/rename/remove. A member may hold many roles.
//
// Pure logic only (no DB): normalization is the uniqueness key stored in
// `project_roles.name_normalized`; the helpers here decide conflicts and build
// the default set. Persisting rows and reading assignments is the caller's job.

import type {
  OfficerKey,
  ProjectPermissions,
  ProjectRoleKind,
  RoleColor,
} from "@quagga/types";
import { normalizeName } from "./name-dedupe";
import { allProjectPermissions } from "./project-permissions";
import { OFFICER_CATALOG } from "./officers";

/** A default project role's authoring metadata (Roles v2). */
export interface DefaultProjectRole {
  name: string;
  sort: number;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string;
  permissions: ProjectPermissions;
}

/**
 * Roles seeded on every new project (Camp 404 basis, questionnaire-spec §"Role
 * kinds"): Captain (captain kind, all perms), Team lead (default kind,
 * manage_questionnaires scoped to the baseline audience + view_member_details),
 * Burner (baseline kind, no perms — every member holds it). `is_default` marks
 * all three in the DB so the UI can treat them as permanent fixtures.
 *
 * Team lead's `manage_questionnaires.audienceRoles` is seeded `"all"` here and
 * re-scoped to the baseline role id after insert (see `teamLeadScopePatch`) —
 * the baseline role's id isn't known until the rows exist.
 */
export const DEFAULT_PROJECT_ROLES: readonly DefaultProjectRole[] = [
  {
    name: "Captain",
    sort: 0,
    kind: "captain",
    color: "apricot",
    emoji: "🎩",
    permissions: allProjectPermissions(),
  },
  {
    name: "Team lead",
    sort: 1,
    kind: "default",
    color: "teal",
    emoji: "🔧",
    permissions: {
      view_member_details: true,
      manage_questionnaires: { audienceRoles: "all", mayBlock: false },
    },
  },
  {
    name: "Burner",
    sort: 2,
    kind: "baseline",
    color: "sage",
    emoji: "🔥",
    permissions: {},
  },
];

/** Max length of a custom role label (UI + boundary guard). */
export const PROJECT_ROLE_NAME_MAX = 60;

/** Max number of roles a single project may hold (questionnaire-spec §"Custom
 * project roles CRUD": "cap 20 roles/project"). Counts defaults + custom. */
export const PROJECT_ROLE_CAP = 20;

/** True when a project is already at (or over) the role cap and may not add more. */
export function roleCapReached(existingCount: number): boolean {
  return existingCount >= PROJECT_ROLE_CAP;
}

/**
 * Canonical uniqueness key for a role name — case/space/punct-insensitive,
 * matching the group-name normalizer. "Team Lead", "team-lead" and "teamlead"
 * all collapse to "teamlead" and so collide on `unique(group_id, normalized)`.
 */
export function normalizeRoleName(name: string): string {
  return normalizeName(name);
}

/** Trimmed, whitespace-collapsed display form of a role name. */
export function cleanRoleName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Validity of a candidate role label: non-empty after cleaning, within max. */
export function isValidRoleName(name: string): boolean {
  const cleaned = cleanRoleName(name);
  return (
    cleaned.length > 0 &&
    cleaned.length <= PROJECT_ROLE_NAME_MAX &&
    normalizeRoleName(cleaned).length > 0
  );
}

/**
 * True when `candidate` collides (normalized) with any of `existingNames`.
 * `exceptNormalized` skips one existing key so a rename to the same value (or a
 * pure case/punct change of the same role) does not self-conflict.
 */
export function roleNameConflicts(
  existingNames: readonly string[],
  candidate: string,
  exceptNormalized?: string,
): boolean {
  const key = normalizeRoleName(candidate);
  return existingNames.some((n) => {
    const existingKey = normalizeRoleName(n);
    if (exceptNormalized !== undefined && existingKey === exceptNormalized) {
      return false;
    }
    return existingKey === key;
  });
}

/**
 * De-duplicate a list of role names by normalized key, keeping first occurrence
 * (in input order). Used when accepting a bulk role list from the builder UI.
 */
export function dedupeRoleNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const cleaned = cleanRoleName(raw);
    if (!isValidRoleName(cleaned)) continue;
    const key = normalizeRoleName(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** A DB-ready project_roles insert row (Roles v2 shape). */
export interface ProjectRoleInsert {
  groupId: string;
  name: string;
  nameNormalized: string;
  isDefault: boolean;
  sort: number;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
  permissions: ProjectPermissions;
  officerKey: OfficerKey | null;
}

/** The default role rows to insert for a freshly created project group. */
export function defaultProjectRoleRows(groupId: string): ProjectRoleInsert[] {
  return DEFAULT_PROJECT_ROLES.map((r) => ({
    groupId,
    name: r.name,
    nameNormalized: normalizeRoleName(r.name),
    isDefault: true,
    sort: r.sort,
    kind: r.kind,
    color: r.color,
    emoji: r.emoji,
    permissions: r.permissions,
    officerKey: null,
  }));
}

/**
 * The officer role rows to materialise for a camp (questionnaire-spec §"Officer
 * roles"). One row per catalog entry; not aliasable, so name/emoji/color come
 * straight from the catalog. `sort` starts after the defaults. Idempotent via
 * the caller's `unique(group_id, name_normalized)` upsert.
 */
export function officerRoleRows(
  groupId: string,
  startSort = 100,
): ProjectRoleInsert[] {
  return OFFICER_CATALOG.map((entry, i) => ({
    groupId,
    name: entry.name,
    nameNormalized: normalizeRoleName(entry.name),
    isDefault: true,
    sort: startSort + i,
    kind: "officer" as ProjectRoleKind,
    color: entry.color,
    emoji: entry.emoji,
    permissions: {} as ProjectPermissions,
    officerKey: entry.key,
  }));
}

/**
 * After the default rows exist, Team lead's `manage_questionnaires` scope is
 * re-pointed from `"all"` to the baseline role's id (questionnaire-spec: Team
 * lead is scoped to Burner audiences). Returns the patch to apply, or null when
 * the roles aren't as expected. Pure — the caller does the DB update.
 */
export function teamLeadScopePatch(
  roles: readonly { id: string; kind: ProjectRoleKind }[],
): { roleId: string; permissions: ProjectPermissions } | null {
  const teamLead = roles.find((r) => r.kind === "default");
  const baseline = roles.find((r) => r.kind === "baseline");
  if (!teamLead || !baseline) return null;
  return {
    roleId: teamLead.id,
    permissions: {
      view_member_details: true,
      manage_questionnaires: { audienceRoles: [baseline.id], mayBlock: false },
    },
  };
}

/** True when a role kind may be deleted by a camp (only `custom`). */
export function canDeleteRoleKind(kind: ProjectRoleKind): boolean {
  return kind === "custom";
}

/** True when a role kind may be renamed by a camp (everything but officers). */
export function canRenameRoleKind(kind: ProjectRoleKind): boolean {
  return kind !== "officer";
}

/**
 * True when a role kind is the derived baseline — held by EVERY member of the
 * camp, never stored per-member. The "everyone in this project" questionnaire
 * audience IS this role (one concept, not two).
 */
export function isBaselineKind(kind: ProjectRoleKind): boolean {
  return kind === "baseline";
}

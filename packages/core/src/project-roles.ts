// Custom per-project roles (questionnaire-spec §"Custom project roles"). These
// are labels — used for organisation + questionnaire audiences — and are
// SEPARATE from the structural `memberships.role` ladder (god/org_staff/lead/
// admin/member), which governs permissions. Defaults are seeded on project
// creation; leads/admins add/rename/remove. A member may hold many roles.
//
// Pure logic only (no DB): normalization is the uniqueness key stored in
// `project_roles.name_normalized`; the helpers here decide conflicts and build
// the default set. Persisting rows and reading assignments is the caller's job.

import { normalizeName } from "./name-dedupe";

/** A default project role's authoring metadata (name + display order). */
export interface DefaultProjectRole {
  name: string;
  sort: number;
}

/**
 * Roles seeded on every new project (Camp 404 basis, questionnaire-spec):
 * Captain, Team lead, Burn member. `is_default` marks these in the DB so the UI
 * can treat them differently from user-added roles.
 */
export const DEFAULT_PROJECT_ROLES: readonly DefaultProjectRole[] = [
  { name: "Captain", sort: 0 },
  { name: "Team lead", sort: 1 },
  { name: "Burn member", sort: 2 },
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

/** The default role rows to insert for a freshly created project group. */
export function defaultProjectRoleRows(groupId: string): {
  groupId: string;
  name: string;
  nameNormalized: string;
  isDefault: boolean;
  sort: number;
}[] {
  return DEFAULT_PROJECT_ROLES.map((r) => ({
    groupId,
    name: r.name,
    nameNormalized: normalizeRoleName(r.name),
    isDefault: true,
    sort: r.sort,
  }));
}

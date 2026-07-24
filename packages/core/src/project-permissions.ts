// Project permissions (questionnaire-spec §"Roles v2 — permissions, color,
// emoji"). Custom-role permissions are GRANTS ON TOP for plain members; the
// structural `lead`/`admin` roles are the permission BACKSTOP — they implicitly
// hold every project permission and this can never be revoked, so no permission
// edit can ever strand a camp (no self-lockout class of bugs, by construction).
//
// Pure logic only — no I/O. The caller loads a member's structural role plus the
// permissions objects of every project role they hold (INCLUDING the derived
// baseline role, which everyone holds) and passes them in.

import type {
  ManageQuestionnairesScope,
  MembershipRole,
  ProjectPermissionKey,
  ProjectPermissions,
  ProjectRoleKind,
} from "@quagga/types";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";

const ADMIN_BACKSTOP = new Set<MembershipRole>(PROJECT_ADMIN_ROLES);

/** True when a structural role implicitly holds every project permission. */
export function isPermissionBackstop(role: MembershipRole): boolean {
  return ADMIN_BACKSTOP.has(role);
}

/**
 * A member's permission inputs: their structural role and the permissions
 * objects of every project role they hold (baseline included, since baseline is
 * held by everyone). Officer/custom/default/captain role permissions all land
 * here as plain `ProjectPermissions` objects.
 */
export interface PermissionMembership {
  structuralRole: MembershipRole;
  rolePermissions: readonly ProjectPermissions[];
}

/**
 * Does the member hold a given project permission? lead/admin → always true
 * (irrevocable backstop). Otherwise the grant must appear on one of their roles.
 * `manage_roles` implies `assign_roles`.
 */
export function hasProjectPermission(
  m: PermissionMembership,
  key: ProjectPermissionKey,
): boolean {
  if (isPermissionBackstop(m.structuralRole)) return true;
  for (const p of m.rolePermissions) {
    if (key === "manage_questionnaires") {
      if (p.manage_questionnaires) return true;
      continue;
    }
    if (key === "assign_roles" && p.manage_roles === true) return true;
    if (p[key] === true) return true;
  }
  return false;
}

/**
 * May the member author/send a project questionnaire to a given audience? This
 * is the SERVER-SIDE enforcement of the `manage_questionnaires` scope config
 * (audience_roles + may_block) — the missing check the earlier review flagged.
 *
 * - lead/admin → always allowed (backstop).
 * - otherwise the member must hold `manage_questionnaires` on some role; the
 *   union of those roles' scopes decides:
 *     · blocking send requires `mayBlock` on at least one granting role;
 *     · targeting is allowed if any granting role has `audienceRoles: "all"`,
 *       else every targeted role id must be within the allowed union.
 *
 * `everyone` (baseline) audiences are represented by passing the baseline role
 * id in `targetRoleIds` — targeting the whole camp is targeting the baseline.
 */
export function canManageQuestionnaireAudience(
  m: PermissionMembership,
  req: { targetRoleIds: readonly string[]; blocking: boolean },
): boolean {
  if (isPermissionBackstop(m.structuralRole)) return true;

  let granted = false;
  let allowAll = false;
  let mayBlock = false;
  const allowed = new Set<string>();
  for (const p of m.rolePermissions) {
    const scope: ManageQuestionnairesScope | undefined = p.manage_questionnaires;
    if (!scope) continue;
    granted = true;
    if (scope.mayBlock) mayBlock = true;
    if (scope.audienceRoles === "all") allowAll = true;
    else for (const id of scope.audienceRoles) allowed.add(id);
  }
  if (!granted) return false;
  if (req.blocking && !mayBlock) return false;
  if (allowAll) return true;
  return req.targetRoleIds.every((id) => allowed.has(id));
}

// --- Captain lock + kind-derived permission rules -------------------------

/** The full permissions object (every privilege, all audiences, may block). */
export function allProjectPermissions(): ProjectPermissions {
  return {
    view_member_details: true,
    manage_questionnaires: { audienceRoles: "all", mayBlock: true },
    assign_roles: true,
    manage_roles: true,
    manage_members: true,
  };
}

/**
 * Captains can do everything — that's what makes them captains. Their
 * permissions are LOCKED to all; the editor shows disabled toggles. Enforce it
 * on every write so a captain row can never drift below full rights.
 */
export function isPermissionsLockedKind(kind: ProjectRoleKind): boolean {
  return kind === "captain";
}

/**
 * Coerce a permissions object to what a role of `kind` is ALLOWED to store.
 * Captain → forced to all (locked). Every other kind keeps the supplied
 * permissions unchanged.
 */
export function enforceKindPermissions(
  kind: ProjectRoleKind,
  permissions: ProjectPermissions,
): ProjectPermissions {
  if (isPermissionsLockedKind(kind)) return allProjectPermissions();
  return permissions;
}

/**
 * Does assigning this role grant role-/member-management authority — i.e. would
 * handing it to someone escalate them onto the manage_roles/manage_members axis?
 * Captain (locked to all) always qualifies. Used to gate assignment: the
 * escalation clause (questionnaire-spec §"Roles v2" CRUD) only sanctions a
 * `manage_roles` holder granting such privileges, so an `assign_roles`-only
 * holder must not be able to hand out (or self-assign) an elevating role.
 */
export function roleGrantsElevatedPrivileges(
  kind: ProjectRoleKind,
  permissions: ProjectPermissions,
): boolean {
  if (isPermissionsLockedKind(kind)) return true;
  return permissions.manage_roles === true || permissions.manage_members === true;
}

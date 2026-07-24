// Questionnaire authorization (questionnaire-spec §"Guardrails" + §"Authoring
// levels"). Who may author / activate / view results at each level:
//   - ORG level (org_internal / org_outbound): org_staff or god on the org
//     group.
//   - PROJECT level: the project's own lead or admin.
//   - Results visibility NEVER crosses scope: an org author cannot see a
//     project's responses, and a project admin cannot see org responses or
//     another project's.
//
// Pure predicates over the actor's memberships — no I/O. Structural roles only
// (custom project roles are labels, not permissions).

import type {
  AudienceSpec,
  MembershipRole,
  ProjectAudience,
} from "@quagga/types";
import {
  canManageQuestionnaireAudience,
  isPermissionBackstop,
  type PermissionMembership,
} from "./project-permissions";

/** The actor's memberships, trimmed to role + group. */
export interface AuthzMembership {
  groupId: string;
  role: MembershipRole;
}

const ORG_AUTHOR_ROLES = new Set<MembershipRole>(["god", "org_staff"]);
const PROJECT_ADMIN = new Set<MembershipRole>(["lead", "admin"]);

/** True when the actor is org_staff or god on the org group. */
export function isOrgAuthor(
  memberships: readonly AuthzMembership[],
  orgGroupId: string,
): boolean {
  return memberships.some(
    (m) => m.groupId === orgGroupId && ORG_AUTHOR_ROLES.has(m.role),
  );
}

/** True when the actor is lead or admin of the given project group. */
export function isProjectAdmin(
  memberships: readonly AuthzMembership[],
  groupId: string,
): boolean {
  return memberships.some(
    (m) => m.groupId === groupId && PROJECT_ADMIN.has(m.role),
  );
}

/**
 * May the actor AUTHOR/ACTIVATE the given audience spec? Org specs need an org
 * author; project specs need admin of that specific group. (Authoring and
 * activating share the same gate in this feature.)
 */
export function canAuthorAudience(
  memberships: readonly AuthzMembership[],
  spec: AudienceSpec,
  orgGroupId: string,
): boolean {
  if (spec.kind === "project") {
    return isProjectAdmin(memberships, spec.groupId);
  }
  return isOrgAuthor(memberships, orgGroupId);
}

/** Alias — activation shares the authoring gate. */
export const canActivateAudience = canAuthorAudience;

/** A trimmed activation row for results-visibility checks. */
export interface AuthzActivation {
  authoredScope: "org" | "group";
  groupId: string | null;
}

/**
 * May the actor VIEW RESULTS for an activation? This is the scope boundary:
 *   - `org`   → only org authors (god/org_staff).
 *   - `group` → only that project's lead/admin (never org, never other camps).
 * A god who is not an admin of the project CANNOT see its project-scoped
 * results — scope is never crossed.
 */
export function canViewActivationResults(
  memberships: readonly AuthzMembership[],
  activation: AuthzActivation,
  orgGroupId: string,
): boolean {
  if (activation.authoredScope === "org") {
    return isOrgAuthor(memberships, orgGroupId);
  }
  return (
    activation.groupId != null &&
    isProjectAdmin(memberships, activation.groupId)
  );
}

/** May the actor manage a project's custom roles? Its lead/admin only. */
export function canManageProjectRoles(
  memberships: readonly AuthzMembership[],
  groupId: string,
): boolean {
  return isProjectAdmin(memberships, groupId);
}

/**
 * The project_role ids a ProjectAudience targets for scope-checking. "everyone"
 * (baseline) resolves to the baseline role id — targeting the whole camp IS
 * targeting the baseline (questionnaire-spec §"Role kinds").
 */
export function projectAudienceTargetRoleIds(
  audience: ProjectAudience,
  baselineRoleId: string | null,
): string[] {
  if (audience.mode === "everyone") {
    return baselineRoleId ? [baselineRoleId] : [];
  }
  return [...audience.roleIds];
}

/**
 * May the actor AUTHOR/SEND a PROJECT questionnaire to this audience? Project
 * questionnaires may be authored by lead/admin OR any member holding
 * `manage_questionnaires` — but ONLY within their configured scope
 * (audience_roles + may_block), ENFORCED server-side here (questionnaire-spec
 * §"Roles v2"; resolves the previously-skipped scope-enforcement finding).
 *
 * `baselineRoleId` is the camp's baseline role id (for the "everyone" audience);
 * pass null only when it genuinely doesn't exist — a non-backstop actor is then
 * denied the everyone audience since scope can't be verified.
 */
export function canAuthorProjectQuestionnaire(
  m: PermissionMembership,
  audience: ProjectAudience,
  blocking: boolean,
  baselineRoleId: string | null,
): boolean {
  if (isPermissionBackstop(m.structuralRole)) return true;
  if (audience.mode === "everyone" && !baselineRoleId) return false;
  const targetRoleIds = projectAudienceTargetRoleIds(audience, baselineRoleId);
  return canManageQuestionnaireAudience(m, { targetRoleIds, blocking });
}

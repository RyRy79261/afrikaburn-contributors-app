// Audience resolution (questionnaire-spec §"Authoring levels & audiences").
// `resolveAudience(spec, ctx)` turns a stored audience spec into the concrete
// set of user ids to target — the send-time expansion that becomes
// `required_actions` rows.
//
// PURITY CONTRACT: this is a pure function over INJECTED row sets (the context)
// so it is fully unit-testable without a DB. The caller (a route handler /
// activation service) is responsible for loading the rows for the active
// edition and passing them in. No I/O, no env, no DB imports.

import type {
  AudienceSpec,
  GroupKind,
  MembershipRole,
  OfficerKey,
  OrgOutboundSelector,
  ProjectRoleKind,
  RoleAssignmentConsent,
} from "@quagga/types";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";

/** A membership row, trimmed to what audience resolution needs. */
export interface AudienceMembership {
  membershipId: string;
  userId: string;
  groupId: string;
  role: MembershipRole;
}

/** A group row, trimmed to what audience resolution needs. */
export interface AudienceGroup {
  id: string;
  kind: GroupKind;
}

/** A registration row for the active edition (grant flags + status). */
export interface AudienceRegistration {
  groupId: string;
  editionId: string;
  status: string;
  grantsInterest: boolean | null;
}

/** A burner-bio row (presence = a burner exists for that edition). */
export interface AudienceBio {
  userId: string;
  editionId: string;
}

/** A supplier row that has claimed a portal account (`suppliers.user_id`). */
export interface AudienceSupplier {
  /** The linked burner/supplier account id (never null — accountless catalog
   * rows are filtered out by the caller before they reach here). */
  userId: string;
}

/** A custom-role assignment (membership × project_role). */
export interface AudienceRoleAssignment {
  membershipId: string;
  projectRoleId: string;
  /** Officer assignments carry consent; non-officer rows default `accepted`. */
  consent?: RoleAssignmentConsent;
}

/** A project_role row, trimmed to what audience resolution needs. */
export interface AudienceProjectRole {
  id: string;
  groupId: string;
  kind: ProjectRoleKind;
  officerKey: OfficerKey | null;
}

/**
 * Everything `resolveAudience` reads. All row sets are for (or filtered to) the
 * relevant edition by the caller; `editionId` lets the function itself filter
 * edition-relative selectors defensively.
 */
export interface AudienceContext {
  editionId: string;
  /** The single org group's id (org_internal targets its members). */
  orgGroupId: string;
  memberships: readonly AudienceMembership[];
  groups: readonly AudienceGroup[];
  registrations: readonly AudienceRegistration[];
  bios: readonly AudienceBio[];
  roleAssignments: readonly AudienceRoleAssignment[];
  /** All project_roles (needed for baseline derivation + officer resolution).
   * Optional so pre-Roles-v2 callers still type-check; absent ⇒ empty. */
  projectRoles?: readonly AudienceProjectRole[];
  /** Suppliers with a claimed portal account (the `org_suppliers` audience).
   * Optional so callers that never target suppliers still type-check; absent ⇒
   * empty (a bulletin to suppliers then reaches nobody, a valid outcome). */
  suppliers?: readonly AudienceSupplier[];
}

const LEAD_ADMIN = new Set<MembershipRole>(PROJECT_ADMIN_ROLES);

/** Sorted, de-duplicated user ids — the canonical audience output shape. */
function finalize(userIds: Iterable<string>): string[] {
  return [...new Set(userIds)].sort();
}

/** Group-id → kind lookup. */
function groupKindMap(ctx: AudienceContext): Map<string, GroupKind> {
  const m = new Map<string, GroupKind>();
  for (const g of ctx.groups) m.set(g.id, g.kind);
  return m;
}

/** User ids of lead/admin memberships in any group matching `predicate`. */
function leadsAdminsOfGroups(
  ctx: AudienceContext,
  groupIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const m of ctx.memberships) {
    if (groupIds.has(m.groupId) && LEAD_ADMIN.has(m.role)) out.push(m.userId);
  }
  return out;
}

/** Group ids of a given kind. */
function groupIdsOfKind(ctx: AudienceContext, kind: GroupKind): Set<string> {
  const out = new Set<string>();
  for (const g of ctx.groups) if (g.kind === kind) out.add(g.id);
  return out;
}

/** Group ids of `kind` with an APPROVED registration this edition. */
function registeredGroupIdsOfKind(
  ctx: AudienceContext,
  kind: GroupKind,
): Set<string> {
  const kinds = groupKindMap(ctx);
  const out = new Set<string>();
  for (const r of ctx.registrations) {
    if (r.editionId !== ctx.editionId) continue;
    if (r.status !== "approved") continue;
    if (kinds.get(r.groupId) === kind) out.add(r.groupId);
  }
  return out;
}

/** Group ids of `kind` whose this-edition registration wants a grant. */
function grantRequesterGroupIdsOfKind(
  ctx: AudienceContext,
  kind: GroupKind,
): Set<string> {
  const kinds = groupKindMap(ctx);
  const out = new Set<string>();
  for (const r of ctx.registrations) {
    if (r.editionId !== ctx.editionId) continue;
    if (r.grantsInterest !== true) continue;
    if (kinds.get(r.groupId) === kind) out.add(r.groupId);
  }
  return out;
}

/** Resolve one org-outbound selector to user ids (unsorted, may repeat). */
function resolveOutboundSelector(
  ctx: AudienceContext,
  selector: OrgOutboundSelector,
): string[] {
  switch (selector) {
    case "all_current_burners":
      return ctx.bios
        .filter((b) => b.editionId === ctx.editionId)
        .map((b) => b.userId);
    case "camp_leads":
      return leadsAdminsOfGroups(ctx, groupIdsOfKind(ctx, "theme_camp"));
    case "registered_camp_leads":
      return leadsAdminsOfGroups(
        ctx,
        registeredGroupIdsOfKind(ctx, "theme_camp"),
      );
    case "mv_leads":
      return leadsAdminsOfGroups(ctx, groupIdsOfKind(ctx, "mutant_vehicle"));
    case "mv_grant_requesters":
      return leadsAdminsOfGroups(
        ctx,
        grantRequesterGroupIdsOfKind(ctx, "mutant_vehicle"),
      );
    case "art_leads":
      return leadsAdminsOfGroups(ctx, groupIdsOfKind(ctx, "artwork"));
    case "art_grant_requesters":
      return leadsAdminsOfGroups(
        ctx,
        grantRequesterGroupIdsOfKind(ctx, "artwork"),
      );
  }
}

/** Resolve a PROJECT audience (everyone, or by custom role) to user ids. */
function resolveProjectAudience(
  ctx: AudienceContext,
  groupId: string,
  mode: "everyone" | "roles" | "leads",
  roleIds: readonly string[],
): string[] {
  const inGroup = ctx.memberships.filter((m) => m.groupId === groupId);
  if (mode === "everyone") return inGroup.map((m) => m.userId);

  // THE CAMP'S DECISION-MAKERS, read off the membership row itself.
  //
  // `lead` and `admin` are structural: they are not grants layered on top of a
  // membership, they ARE the membership, which is why they have no role id for
  // `roles` mode to name. Every camp has at least one without anyone
  // configuring anything — the no-lockout backstop guarantees it — so this is
  // the one camp audience that can never resolve to nobody by misconfiguration.
  if (mode === "leads") {
    return inGroup
      .filter((m) => m.role === "lead" || m.role === "admin")
      .map((m) => m.userId);
  }

  const wanted = new Set(roleIds);
  if (wanted.size === 0) return [];

  // Baseline derivation: if any wanted role is the camp's baseline (everyone-
  // role), the audience is the whole camp — baseline is never stored per member.
  const projectRoles = ctx.projectRoles ?? [];
  const baselineWanted = projectRoles.some(
    (r) => wanted.has(r.id) && r.kind === "baseline",
  );
  if (baselineWanted) return inGroup.map((m) => m.userId);

  // membership ids that hold at least one wanted role (accepted assignments —
  // a pending/declined officer assignment does not yet make someone a target).
  const matchedMemberships = new Set<string>();
  for (const a of ctx.roleAssignments) {
    if (!wanted.has(a.projectRoleId)) continue;
    if ((a.consent ?? "accepted") !== "accepted") continue;
    matchedMemberships.add(a.membershipId);
  }
  return inGroup
    .filter((m) => matchedMemberships.has(m.membershipId))
    .map((m) => m.userId);
}

/**
 * Resolve an ORG OFFICER audience: every member ACCEPTED into one of the wanted
 * officer roles, across every REGISTERED camp (approved registration this
 * edition), regardless of camp aliases. Pending/declined assignments never
 * resolve (org only reaches consented officers).
 */
function resolveOfficerAudience(
  ctx: AudienceContext,
  officerKeys: readonly OfficerKey[],
): string[] {
  const wantedKeys = new Set<OfficerKey>(officerKeys);
  if (wantedKeys.size === 0) return [];

  const registeredGroups = registeredGroupIds(ctx);
  // Officer project_role ids in registered camps matching a wanted key.
  const wantedRoleIds = new Set<string>();
  for (const r of ctx.projectRoles ?? []) {
    if (r.kind !== "officer" || r.officerKey === null) continue;
    if (!wantedKeys.has(r.officerKey)) continue;
    if (!registeredGroups.has(r.groupId)) continue;
    wantedRoleIds.add(r.id);
  }
  if (wantedRoleIds.size === 0) return [];

  const acceptedMemberships = new Set<string>();
  for (const a of ctx.roleAssignments) {
    if (!wantedRoleIds.has(a.projectRoleId)) continue;
    if ((a.consent ?? "accepted") !== "accepted") continue;
    acceptedMemberships.add(a.membershipId);
  }
  const out: string[] = [];
  for (const m of ctx.memberships) {
    if (acceptedMemberships.has(m.membershipId)) out.push(m.userId);
  }
  return out;
}

/** Group ids (any kind) with an APPROVED registration this edition. */
function registeredGroupIds(ctx: AudienceContext): Set<string> {
  const out = new Set<string>();
  for (const r of ctx.registrations) {
    if (r.editionId !== ctx.editionId) continue;
    if (r.status === "approved") out.add(r.groupId);
  }
  return out;
}

/**
 * Expand an audience spec into the de-duplicated, sorted set of user ids to
 * target. Empty audiences (e.g. grant-requester selectors before those flows
 * ship) resolve to `[]` — a valid, non-error outcome.
 */
export function resolveAudience(
  spec: AudienceSpec,
  ctx: AudienceContext,
): string[] {
  switch (spec.kind) {
    case "org_internal": {
      const ids = ctx.memberships
        .filter((m) => m.groupId === ctx.orgGroupId)
        .map((m) => m.userId);
      return finalize(ids);
    }
    case "org_outbound": {
      const ids: string[] = [];
      for (const selector of spec.selectors) {
        ids.push(...resolveOutboundSelector(ctx, selector));
      }
      return finalize(ids);
    }
    case "org_officer": {
      return finalize(resolveOfficerAudience(ctx, spec.officerKeys));
    }
    case "org_suppliers": {
      // Suppliers are a different account kind: they live in `ctx.suppliers`
      // (linked via suppliers.user_id), never in memberships/bios. Only account-
      // linked suppliers can receive an in-app notification, so that is exactly
      // the set this returns — no burner, lead, or officer can leak in.
      return finalize((ctx.suppliers ?? []).map((s) => s.userId));
    }
    case "project": {
      return finalize(
        resolveProjectAudience(ctx, spec.groupId, spec.mode, spec.roleIds),
      );
    }
  }
}

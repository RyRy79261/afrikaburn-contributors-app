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
  OrgOutboundSelector,
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

/** A custom-role assignment (membership × project_role). */
export interface AudienceRoleAssignment {
  membershipId: string;
  projectRoleId: string;
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
  mode: "everyone" | "roles",
  roleIds: readonly string[],
): string[] {
  const inGroup = ctx.memberships.filter((m) => m.groupId === groupId);
  if (mode === "everyone") return inGroup.map((m) => m.userId);

  const wanted = new Set(roleIds);
  if (wanted.size === 0) return [];

  // membership ids that hold at least one wanted role.
  const matchedMemberships = new Set<string>();
  for (const a of ctx.roleAssignments) {
    if (wanted.has(a.projectRoleId)) matchedMemberships.add(a.membershipId);
  }
  return inGroup
    .filter((m) => matchedMemberships.has(m.membershipId))
    .map((m) => m.userId);
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
    case "project": {
      return finalize(
        resolveProjectAudience(ctx, spec.groupId, spec.mode, spec.roleIds),
      );
    }
  }
}

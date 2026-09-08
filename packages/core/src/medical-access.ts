// Who may SEE a burner's medical notes. PURE predicates only (no I/O, no DB):
// the apps load the actor's org role + structural lead camps and the subject's
// camp memberships, pass them here, and — only if this says yes — decrypt the
// notes onto a member DETAIL view and record the read.
//
// The model (Ryan, 26 Jul 2026): **consent at the point of entry.** AfrikaBurn
// already works this way on paper — you write your medical info on a form
// knowing the safety team and your camp hold it. The DISCLOSURE is the consent.
// So the load-bearing privacy control is the FIELD'S OWN LABEL in the Burner Bio
// ("Your camp leads and AfrikaBurn's safety team can see this…"), not a reveal
// ceremony at read time. A reason prompt in an emergency adds friction at
// exactly the wrong moment without adding protection, so there is none: the
// people the burner disclosed to simply see the notes on that burner's detail.
//
// This module answers exactly one question: is this actor part of the audience
// the burner consented to?
//
//   - the subject themselves (their own data) → always;
//   - the org's safety tier → yes: the System manager, plus any org account
//     whose ORG ROLES resolve `read_personal_information` (org roles v1 — the
//     console's one permission resolver decides this, not a rank rule here);
//   - a camp lead/admin of a camp the SUBJECT is a member of → yes, but only for
//     THEIR OWN camp's members. A lead of camp A is refused for a member of
//     camp B (the camp-id sets must intersect).
//
// A plain member (no org role, leads no camp the subject is in) → no.
//
// What survives from the old break-glass design, because it costs nothing and
// matters: medical stays ENCRYPTED at rest, stays excluded from EVERY public
// projection unconditionally (privacy.ts), stays OFF list views and exports, and
// every disclosing read is still AUDITED — a free, non-blocking row that makes
// enumeration detectable and answers "who read what".

import type { MembershipRole } from "@quagga/types";

/**
 * The org-group membership roles that historically meant "operator tier".
 *
 * SINCE ORG ROLES v1 THIS IS NOT THE MEDICAL DECISION. `memberships.role` on the
 * org group is now only the console DOOR (except `god`, the System manager
 * anchor); what an org account may see comes from the org roles it holds and is
 * resolved by @quagga/core `org-permissions` → `read_personal_information`. This
 * predicate survives for the one job it still does honestly: preferring the
 * strongest of several org membership rows when a deployment has more than one
 * org group.
 *
 * `engineer` IS DELIBERATELY ABSENT here — medical notes are the sharpest
 * personal information in the system and running the servers is not a care duty.
 * Since 27 Jul 2026 that is not merely the seeded row's default either: the
 * engineer RANK never resolves `read_personal_information` at all
 * (`ENGINEER_RANK_CARVE_OUTS`), so the org branch below is closed to them
 * whatever roles they hold. An engineer who leads a camp still reads THEIR OWN
 * camp's members through the camp branch — a different authority, correctly
 * recorded as `camp_lead` on the audit row.
 */
const ORG_STAFF_ROLES: ReadonlySet<MembershipRole> = new Set([
  "god",
  "org_staff",
]);

/**
 * Rank precedence when a viewer holds SEVERAL org-group rows. Strongest first;
 * a role absent from this list is not an org rank at all and is weaker than
 * every entry in it.
 *
 * `org_staff` outranks `engineer` deliberately, and it is not a typo. An
 * engineer is BROADER in reach and NARROWER in depth — `ENGINEER_RANK_CARVE_OUTS`
 * refuses them `read_personal_information` everywhere, whatever roles they hold
 * (org-permissions.ts). So an account holding both rows genuinely reads personal
 * information as org_staff, and picking the engineer row would understate the
 * access they actually have.
 */
const ORG_ROLE_PRECEDENCE: readonly MembershipRole[] = [
  "god",
  "org_staff",
  "engineer",
];

/**
 * The strongest org-group role a viewer holds, or null when they hold none.
 *
 * WHY THIS EXISTS. A viewer can hold membership rows on more than one org group
 * (the schema does not forbid a second one, and a staging import or a renamed
 * duplicate creates one). The fold that picked among them used to be
 * `if (!isOrgStaffRole(actorOrgRole)) actorOrgRole = row.role` — and
 * `isOrgStaffRole` is TRUE for only `god` and `org_staff`, so an `engineer` in
 * hand was overwritten by any later ordinary row. The engineer then resolved no
 * rank at all, and the caller's `?? "org_staff"` fallback promoted them into the
 * exact tier the carve-out exists to keep them out of — handing them medical
 * notes in the participant app that the console refuses them. That is the
 * disagreement between two apps the carve-out comment warns about, arrived at
 * from the other direction.
 *
 * Order-independent by construction: the result depends on the SET of roles, not
 * on the order the rows came back in.
 */
export function strongestOrgRole(
  roles: readonly MembershipRole[],
): MembershipRole | null {
  let best: MembershipRole | null = null;
  let bestRank = ORG_ROLE_PRECEDENCE.length;
  for (const role of roles) {
    const index = ORG_ROLE_PRECEDENCE.indexOf(role);
    const rank = index === -1 ? ORG_ROLE_PRECEDENCE.length : index;
    if (best === null || rank < bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best;
}

/** True when a role is org staff (god or org_staff) — the console door. */
export function isOrgStaffRole(
  role: MembershipRole | null | undefined,
): boolean {
  return role != null && ORG_STAFF_ROLES.has(role);
}

/**
 * The facts an access decision needs. The caller resolves each server-side:
 *  - `isSelf`: the actor is the subject (reading their own notes).
 *  - `actorOrgRole`: the actor's role on the seeded org group, or null. Only
 *    `god` decides anything on its own (the System manager anchor).
 *  - `actorOrgPersonalInformation`: the ORG CONSOLE'S RESOLVED
 *    `read_personal_information` for this actor IN THE `registrations` DOMAIN —
 *    i.e. `canReadPersonalInformationIn(actor, "registrations")` over the union
 *    of their org roles. This is the org branch of the decision, so there is ONE
 *    definition of who the org's safety tier is instead of a rank rule here and
 *    a permission there. THE DOMAIN IS PART OF THAT DEFINITION since 27 Jul
 *    2026: a burner's medical notes live on a camp member's page, so a lead of a
 *    department that does not own registrations is not in the safety audience,
 *    however sharp their department's own rights are. Both apps resolve it the
 *    same way (apps/org's member detail page, apps/web's `medical-access.ts`)
 *    and a caller that passed an un-domained answer would silently widen the
 *    audience the burner consented to.
 *  - `actorLeadCampIds`: the camp (group) ids where the actor holds a STRUCTURAL
 *    lead/admin role (the permission backstop). Custom project roles do NOT
 *    grant access — this is deliberately a structural-lead capability.
 *  - `subjectCampIds`: the camp (group) ids the SUBJECT is a member of.
 */
export interface MedicalAccessContext {
  isSelf: boolean;
  actorOrgRole: MembershipRole | null;
  actorOrgPersonalInformation?: boolean;
  actorLeadCampIds: readonly string[];
  subjectCampIds: readonly string[];
}

/**
 * Is the actor part of AfrikaBurn's org-side safety audience? The System manager
 * always; otherwise exactly the actors whose org roles resolve
 * `read_personal_information`. An org account with no roles is NOT — the door is
 * not the tier.
 */
function isOrgSafetyTier(ctx: MedicalAccessContext): boolean {
  if (ctx.actorOrgRole === "god") return true;
  return ctx.actorOrgPersonalInformation === true;
}

/**
 * May the actor see the subject's medical notes? Pure and fail-closed: anything
 * not explicitly permitted returns false. This is the server-side boundary —
 * hiding the section in the UI is never the control.
 */
export function canViewMedicalNotes(ctx: MedicalAccessContext): boolean {
  if (ctx.isSelf) return true;
  if (isOrgSafetyTier(ctx)) return true;
  if (ctx.actorLeadCampIds.length === 0 || ctx.subjectCampIds.length === 0) {
    return false;
  }
  const subjectCamps = new Set(ctx.subjectCampIds);
  return ctx.actorLeadCampIds.some((id) => subjectCamps.has(id));
}

/** Which authority a permitted read rests on — stored on the audit row so the
 * trail records WHY the access was allowed. `null` when access is refused. */
export type MedicalAccessBasis = "self" | "org_staff" | "camp_lead";

export function medicalAccessBasis(
  ctx: MedicalAccessContext,
): MedicalAccessBasis | null {
  if (ctx.isSelf) return "self";
  if (isOrgSafetyTier(ctx)) return "org_staff";
  if (canViewMedicalNotes(ctx)) return "camp_lead";
  return null;
}

/**
 * The audit `action` string every disclosing read writes (actor, subject, basis,
 * timestamp). Written server-side AFTER the notes are resolved and never on the
 * critical path — the read must not be blocked or slowed by its own audit row.
 */
export const MEDICAL_VIEW_AUDIT_ACTION = "bio.medical.view";

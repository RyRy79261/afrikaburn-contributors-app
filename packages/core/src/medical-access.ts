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
//   - org staff (god / org_staff) → yes (AfrikaBurn's safety/ops tier);
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
 * The org-group roles that may see any burner's medical notes.
 *
 * `engineer` IS DELIBERATELY ABSENT and must stay absent. An engineer holds the
 * org console's widest READ — they run the thing — but medical notes are the
 * sharpest personal information in the system and the engineering rank exists
 * without any care duty that would need them (@quagga/core `org-permissions`:
 * `read_personal_information` is refused to engineers, always). Adding it here
 * would silently re-open the notes to a rank the matrix says can never see them,
 * from a module the matrix does not import. Don't.
 */
const ORG_STAFF_ROLES: ReadonlySet<MembershipRole> = new Set([
  "god",
  "org_staff",
]);

/** True when a role is org staff (god or org_staff) — the operator tier. */
export function isOrgStaffRole(
  role: MembershipRole | null | undefined,
): boolean {
  return role != null && ORG_STAFF_ROLES.has(role);
}

/**
 * The facts an access decision needs. The caller resolves each server-side:
 *  - `isSelf`: the actor is the subject (reading their own notes).
 *  - `actorOrgRole`: the actor's role on the seeded org group, or null.
 *  - `actorLeadCampIds`: the camp (group) ids where the actor holds a STRUCTURAL
 *    lead/admin role (the permission backstop). Custom project roles do NOT
 *    grant access — this is deliberately a structural-lead capability.
 *  - `subjectCampIds`: the camp (group) ids the SUBJECT is a member of.
 */
export interface MedicalAccessContext {
  isSelf: boolean;
  actorOrgRole: MembershipRole | null;
  actorLeadCampIds: readonly string[];
  subjectCampIds: readonly string[];
}

/**
 * May the actor see the subject's medical notes? Pure and fail-closed: anything
 * not explicitly permitted returns false. This is the server-side boundary —
 * hiding the section in the UI is never the control.
 */
export function canViewMedicalNotes(ctx: MedicalAccessContext): boolean {
  if (ctx.isSelf) return true;
  if (isOrgStaffRole(ctx.actorOrgRole)) return true;
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
  if (isOrgStaffRole(ctx.actorOrgRole)) return "org_staff";
  if (canViewMedicalNotes(ctx)) return "camp_lead";
  return null;
}

/**
 * The audit `action` string every disclosing read writes (actor, subject, basis,
 * timestamp). Written server-side AFTER the notes are resolved and never on the
 * critical path — the read must not be blocked or slowed by its own audit row.
 */
export const MEDICAL_VIEW_AUDIT_ACTION = "bio.medical.view";

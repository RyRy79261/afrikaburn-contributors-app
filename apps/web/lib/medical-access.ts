import "server-only";

import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  buildDomainOwnership,
  canReadPersonalInformationIn,
  canViewMedicalNotes,
  isOrgStaffRole,
  medicalAccessBasis,
  orgRankFromRole,
  sanitizeOrgPermissions,
  MEDICAL_VIEW_AUDIT_ACTION,
  type MedicalAccessContext,
} from "@quagga/core";
import { db, schema } from "./db";
import { decryptField } from "./crypto-guard";

/**
 * Resolve a burner's medical notes FOR A VIEWER on that burner's detail page.
 *
 * The model (Ryan, 26 Jul 2026): the consent is the disclosure. The burner wrote
 * these notes under a label that names the audience — their camp leads and
 * AfrikaBurn's safety team — so those people simply SEE the notes on the
 * burner's detail view. No reason prompt, no reveal dialog, no per-view
 * notification: friction in an emergency protects nobody.
 *
 * What this still guarantees:
 *  - server-side authz is the boundary (`canViewMedicalNotes` over memberships
 *    re-derived here — a lead of camp A gets nothing for a member of camp B);
 *  - the notes are decrypted only after that predicate says yes;
 *  - a disclosing read is AUDITED (actor, subject, basis) — off the critical
 *    path via `after()`, so the audit row never blocks or slows the read;
 *  - this is a DETAIL-view resolver, one subject at a time. Nothing here is
 *    reachable from a roster, a list, or an export.
 */
export async function resolveMedicalNotesForViewer(input: {
  viewerUserId: string;
  subjectUserId: string;
  editionId: string;
}): Promise<{ visible: boolean; notes: string | null; unreadable: boolean }> {
  const { viewerUserId, subjectUserId, editionId } = input;
  const isSelf = viewerUserId === subjectUserId;

  const ctx = await buildMedicalAccessContext(viewerUserId, subjectUserId);
  if (!canViewMedicalNotes(ctx))
    return { visible: false, notes: null, unreadable: false };

  const [bio] = await db()
    .select({ medicalNotes: schema.burnerBios.medicalNotes })
    .from(schema.burnerBios)
    .where(
      and(
        eq(schema.burnerBios.userId, subjectUserId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .limit(1);
  // Three-state, not two: ciphertext we cannot decrypt must not present as
  // "this burner recorded nothing". Silently hiding the section from a camp
  // lead in an emergency is the same failure as the console's false all-clear.
  const decrypted = bio ? decryptField(bio.medicalNotes) : null;
  const notes = decrypted?.value ?? null;
  const unreadable = decrypted?.state === "unreadable";

  // Audit only an actual disclosure of someone ELSE's notes: reading your own
  // data is not an access event, and an empty field discloses nothing. Written
  // after the response so a slow/failed audit never degrades the read.
  //
  // This FAILS OPEN — the notes are already streamed before the insert is
  // attempted, and the error is swallowed below. That is the right trade for an
  // emergency read: nobody should wait on a log row to find out someone is
  // diabetic. No rate limit gates this path either, for the same reason.
  //
  // The row is a RECORD, not surveillance. It answers "who saw my medical
  // information?" if a burner asks, and lets a real incident be reconstructed.
  // It is deliberately not aggregated, thresholded or alerted on: reading a lot
  // of notes in one sitting is normal medic work, not a red flag.
  if (!isSelf && notes) {
    const basis = medicalAccessBasis(ctx);
    after(async () => {
      try {
        await db().insert(schema.auditEvents).values({
          actorId: viewerUserId,
          action: MEDICAL_VIEW_AUDIT_ACTION,
          subject: subjectUserId,
          meta: { basis },
        });
      } catch (err) {
        console.error("[medical-access] audit write failed", err);
      }
    });
  }

  return { visible: true, notes, unreadable };
}

/**
 * Load the facts the pure predicate needs: the viewer's org-group role, the
 * camps where the viewer holds a STRUCTURAL lead/admin role, and the camps the
 * subject belongs to. Custom project roles deliberately grant nothing here.
 */
async function buildMedicalAccessContext(
  viewerUserId: string,
  subjectUserId: string,
): Promise<MedicalAccessContext> {
  const handle = db();
  // EVERY org group, not the first one found. The schema's unique index is on
  // (kind, name_normalized), so more than one `kind: 'org'` row is permitted —
  // a staging import or a renamed duplicate creates one. Picking a single row
  // (no ORDER BY, so not even deterministically) failed OPEN: an org group that
  // was not the one picked is not recognised as `isOrgGroup`, so a lead/admin
  // membership on it lands in actorLeadCampIds and any member of it lands in
  // subjectCampIds — and the intersection then grants medical access THROUGH an
  // org group. Treating the whole set as org groups closes that, and makes the
  // resolver's behaviour independent of row order.
  const orgGroups = await handle
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.kind, "org"));
  const orgGroupIds = new Set(orgGroups.map((g) => g.id));

  const rows = await handle
    .select({
      id: schema.memberships.id,
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .where(inArray(schema.memberships.userId, [viewerUserId, subjectUserId]));

  const actorLeadCampIds: string[] = [];
  const subjectCampIds: string[] = [];
  const actorOrgMembershipIds: string[] = [];
  let actorOrgRole: MedicalAccessContext["actorOrgRole"] = null;

  for (const row of rows) {
    const isOrgGroup = orgGroupIds.has(row.groupId);
    if (row.userId === viewerUserId) {
      // With more than one org group a viewer can hold several org rows. Keep
      // the STRONGEST: a qualifying role is never overwritten by a later
      // non-qualifying one, so the outcome does not depend on row order.
      if (isOrgGroup) {
        if (!isOrgStaffRole(actorOrgRole)) actorOrgRole = row.role;
        actorOrgMembershipIds.push(row.id);
      } else if (row.role === "lead" || row.role === "admin") {
        actorLeadCampIds.push(row.groupId);
      }
    }
    if (row.userId === subjectUserId && !isOrgGroup) {
      subjectCampIds.push(row.groupId);
    }
  }

  // THE ORG BRANCH IS A SCOPED CAPABILITY NOW, NOT A RANK. Since org roles v1
  // an org membership is only the console door; whether its holder is part of
  // the org's safety audience is decided by the org roles they hold resolving
  // `read_personal_information` — the same resolver apps/org uses, so the two
  // apps cannot disagree about who may read a burner's medical notes.
  //
  // AND SINCE 27 JUL 2026 THAT RESOLUTION IS PER DOMAIN, which matters here more
  // than anywhere: this used to flatten every role to `departmentId: null`,
  // i.e. to treat every departmental grant as org-wide. Once departments became
  // real that was a hole — a Suppliers lead opening any burner's profile in the
  // PARTICIPANT app would have read medical notes the console would have
  // refused them. A burner's bio belongs to the `registrations` domain (the same
  // domain the console's member detail asks for), and the role's own department
  // is now carried through rather than erased.
  //
  // (The `god` anchor is handled inside the predicate and needs no roles.)
  let actorOrgPersonalInformation = false;
  if (actorOrgMembershipIds.length > 0) {
    const [grants, owners] = await Promise.all([
      handle
        .select({
          departmentId: schema.orgRoles.departmentId,
          permissions: schema.orgRoles.permissions,
        })
        .from(schema.orgRoleAssignments)
        .innerJoin(
          schema.orgRoles,
          eq(schema.orgRoles.id, schema.orgRoleAssignments.orgRoleId),
        )
        .where(
          inArray(
            schema.orgRoleAssignments.membershipId,
            actorOrgMembershipIds,
          ),
        ),
      handle
        .select({
          domain: schema.orgDepartmentDomains.domain,
          departmentId: schema.orgDepartmentDomains.departmentId,
          departmentName: schema.orgDepartments.name,
        })
        .from(schema.orgDepartmentDomains)
        .innerJoin(
          schema.orgDepartments,
          eq(
            schema.orgDepartments.id,
            schema.orgDepartmentDomains.departmentId,
          ),
        ),
    ]);
    actorOrgPersonalInformation = canReadPersonalInformationIn(
      {
        // THE REAL RANK, not a stand-in. It used to be hardcoded `org_staff`
        // on the grounds that only the roles mattered; that stopped being true
        // when the engineer rank gained a carve-out. Passing org_staff for an
        // engineer would let a role edit hand them medical notes in the
        // participant app that the console refuses them — the two apps must
        // resolve this identically. `god` is also decided by `actorOrgRole`
        // inside the predicate, so agreeing with it here is harmless.
        rank: orgRankFromRole(actorOrgRole) ?? "org_staff",
        domains: buildDomainOwnership(owners),
        roles: grants.map((g) => ({
          id: "",
          key: "",
          name: "",
          kind: "custom" as const,
          departmentId: g.departmentId,
          permissions: sanitizeOrgPermissions(g.permissions),
        })),
      },
      "registrations",
    );
  }

  return {
    isSelf: viewerUserId === subjectUserId,
    actorOrgRole,
    actorOrgPersonalInformation,
    actorLeadCampIds,
    subjectCampIds,
  };
}

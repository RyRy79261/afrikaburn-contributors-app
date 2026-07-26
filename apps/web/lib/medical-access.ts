import "server-only";

import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  canViewMedicalNotes,
  isOrgStaffRole,
  medicalAccessBasis,
  MEDICAL_VIEW_AUDIT_ACTION,
  type MedicalAccessContext,
} from "@quagga/core";
import { db, schema } from "./db";
import { decryptOrNull } from "./crypto-guard";

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
}): Promise<{ visible: boolean; notes: string | null }> {
  const { viewerUserId, subjectUserId, editionId } = input;
  const isSelf = viewerUserId === subjectUserId;

  const ctx = await buildMedicalAccessContext(viewerUserId, subjectUserId);
  if (!canViewMedicalNotes(ctx)) return { visible: false, notes: null };

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
  const notes = bio ? decryptOrNull(bio.medicalNotes) : null;

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

  return { visible: true, notes };
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
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .where(
      inArray(schema.memberships.userId, [viewerUserId, subjectUserId]),
    );

  const actorLeadCampIds: string[] = [];
  const subjectCampIds: string[] = [];
  let actorOrgRole: MedicalAccessContext["actorOrgRole"] = null;

  for (const row of rows) {
    const isOrgGroup = orgGroupIds.has(row.groupId);
    if (row.userId === viewerUserId) {
      // With more than one org group a viewer can hold several org rows. Keep
      // the STRONGEST: a qualifying role is never overwritten by a later
      // non-qualifying one, so the outcome does not depend on row order.
      if (isOrgGroup) {
        if (!isOrgStaffRole(actorOrgRole)) actorOrgRole = row.role;
      } else if (row.role === "lead" || row.role === "admin") {
        actorLeadCampIds.push(row.groupId);
      }
    }
    if (row.userId === subjectUserId && !isOrgGroup) {
      subjectCampIds.push(row.groupId);
    }
  }

  return {
    isSelf: viewerUserId === subjectUserId,
    actorOrgRole,
    actorLeadCampIds,
    subjectCampIds,
  };
}

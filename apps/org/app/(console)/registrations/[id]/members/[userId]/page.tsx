import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { ChevronRight, Lock, Stethoscope } from "lucide-react";
import {
  canReadPersonalInformation,
  canViewMedicalNotes,
  medicalAccessBasis,
  MEDICAL_VIEW_AUDIT_ACTION,
  type MedicalAccessContext,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";

import { guardConsole } from "@/lib/gate";
import { getDb } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { getRegistrationDetail, getRosterMemberDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

// A camp member's DETAIL view in the console — the ONLY org surface that renders
// medical notes, and it renders exactly one person's.
//
// The model (Ryan, 26 Jul 2026): consent lives at the point of entry. The burner
// wrote these notes under a label naming their audience — their camp leads and
// AfrikaBurn's safety team — so org staff simply see them here. No reason
// prompt, no reveal dialog, no notification: friction in an emergency protects
// nobody, and the disclosure was the consent.
//
// What stays: server-side authz (`guardConsole` + the pure `canViewMedicalNotes`
// predicate), encryption at rest (decrypted in `getRosterMemberDetail`), absolute
// exclusion from every public projection, absence from every list/export — the
// roster carries no has/has-not signpost either, since a column of that is an
// un-audited census — and an audit row for each disclosing read, written via
// `after()` so it can never block or slow the read.
//
// That `after()` write FAILS OPEN (already-streamed response, swallowed error),
// which is deliberate: an emergency read must not wait on a log row. The rows
// are a plain record on `/audit` — who read whose notes, when — with no volume
// threshold or alerting, because reading many members' notes in one sitting is
// ordinary medic work rather than something to flag.

const ParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export default async function RegistrationMemberPage({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { id, userId } = parsed.data;

  const detail = await getRegistrationDetail(id, guard.session.actor);
  if (!detail) notFound();

  // Re-check the medical predicate server-side even though only god/org_staff
  // reach this page — the console gate and the privacy law are separate
  // guarantees, and this keeps ONE definition of who may see medical notes.
  //
  // It runs BEFORE the fetch, and its answer is what tells the query whether to
  // select the column at all: on a refusal the ciphertext is never loaded, so
  // there is no plaintext in render scope for a later edit to leak.
  const ctx: MedicalAccessContext = {
    isSelf: guard.session.dbUserId === userId,
    actorOrgRole: guard.session.role,
    // Since org roles v1 the org branch of the medical predicate is the
    // console's RESOLVED `read_personal_information` — the union of this
    // actor's org roles — rather than their membership rank. One definition of
    // who the org's safety tier is, so a role that gains or loses personal
    // information gains or loses medical with it.
    actorOrgPersonalInformation: canReadPersonalInformation(
      guard.session.actor,
    ),
    actorLeadCampIds: [],
    subjectCampIds: [],
  };
  const maySeeMedical = canViewMedicalNotes(ctx);

  const member = await getRosterMemberDetail(
    detail.group.id,
    detail.edition.id,
    userId,
    { includeMedicalNotes: maySeeMedical },
  );
  if (!member) notFound();

  const medicalNotes = member.medicalNotes;

  if (medicalNotes && !ctx.isSelf) {
    const basis = medicalAccessBasis(ctx);
    after(async () => {
      try {
        await writeAuditEvent(getDb(), {
          actorId: guard.session.dbUserId,
          action: MEDICAL_VIEW_AUDIT_ACTION,
          subject: userId,
          meta: { basis, groupId: detail.group.id },
        });
      } catch (err) {
        console.error("[medical-access] audit write failed", err);
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/registrations" className="hover:text-foreground">
          Registrations
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <Link href={`/registrations/${id}`} className="hover:text-foreground">
          {detail.group.name}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <span className="text-foreground">{member.displayName}</span>
      </nav>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {member.displayName}
        </h1>
        <Badge variant={member.role === "lead" ? "default" : "outline"}>
          {member.role === "lead"
            ? "Lead"
            : member.role === "admin"
              ? "Co-lead"
              : "Member"}
        </Badge>
      </header>

      {maySeeMedical && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4 text-accent" aria-hidden />
              Medical notes
            </CardTitle>
            <CardDescription>
              {member.displayName} wrote these knowing their camp leads and
              AfrikaBurn&apos;s safety team can see them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {medicalNotes ? (
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed">
                {medicalNotes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No medical notes on file for this member.
              </p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Never public, never listed or exported, encrypted at rest — and
              this view is recorded in the audit trail.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

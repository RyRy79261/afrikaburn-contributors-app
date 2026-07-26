import { guardConsole } from "@/lib/gate";
import { getAuditTrail, getMedicalAccessLog } from "@/lib/medical-audit";
import { PageHeading } from "@/components/page-heading";
import { MedicalAccessPanel } from "@/components/audit/medical-access-panel";
import { AuditTrailList } from "@/components/audit/audit-trail-list";

// The audit log — the READER the trail never had.
//
// Medical notes are disclosed on a fail-open path: no rate limit, no reveal
// ceremony, and the `bio.medical.view` row is written in `after()` so an
// emergency read is never blocked or slowed by its own logging (AGENTS.md).
// That trade is only honest if the rows are read by someone. Before this page
// they were not: the registration decision log filters by `subject =
// registrationId`, so medical rows (subject = a user id) never appeared there,
// and the Overview feed was six rows with no filter. "Enumeration stays
// detectable" was aspirational. This page is where it becomes true.
//
// Org-gated at the page (`guardConsole` → god / org_staff). It shows WHO read
// WHOSE notes and when — never the notes. Reading the trail is not itself a
// disclosure, so it writes no audit row of its own.

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const [medical, trail] = await Promise.all([
    getMedicalAccessLog(),
    getAuditTrail(100),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Console / Audit"
        title="Audit log"
        description="Who did what, and when. Medical-notes reads are called out first — they are the one action nothing prevents, so seeing them is the control."
      />

      <div className="flex flex-col gap-6">
        <MedicalAccessPanel log={medical} />
        <AuditTrailList rows={trail} />
      </div>
    </div>
  );
}

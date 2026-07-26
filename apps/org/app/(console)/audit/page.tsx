import { guardConsole } from "@/lib/gate";
import { getAuditTrail, getMedicalAccessLog } from "@/lib/medical-audit";
import { PageHeading } from "@/components/page-heading";
import { MedicalAccessPanel } from "@/components/audit/medical-access-panel";
import { AuditTrailList } from "@/components/audit/audit-trail-list";

// The audit log — a plain, chronological record.
//
// It exists so that if a burner ever asks "who saw my medical information?", or
// something goes wrong and it has to be reconstructed, there is an honest
// answer. That is its whole job.
//
// IT IS NOT STAFF MONITORING. There is deliberately no volume threshold, no
// per-actor profiling and no alerting, and there must not be. Reading many
// members' notes in one sitting is what the work looks like — a medic working
// out what to prepare for on site does exactly that — so flagging it would
// report ordinary care as an incident, and would teach the people we most need
// reading this information that the safety tool is watching them. That is worse
// for burners, not better. (Ryan's call, 26 Jul 2026.)
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
        description="Who did what, and when. Medical-notes reads are listed first because that is the record people ask about — not because anyone is being watched."
      />

      <div className="flex flex-col gap-6">
        <MedicalAccessPanel log={medical} />
        <AuditTrailList rows={trail} />
      </div>
    </div>
  );
}

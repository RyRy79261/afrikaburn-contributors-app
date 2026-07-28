import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { orgCapabilityRefusal } from "@quagga/core";

import { guardConsole } from "@/lib/gate";
import {
  canReadMedicalAccessLog,
  getAuditTrail,
  getMedicalAccessLog,
} from "@/lib/medical-audit";
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
// Org-gated at the page (`guardConsole`). It shows WHO read WHOSE notes and when
// — never the notes. Reading the trail is not itself a disclosure, so it writes
// no audit row of its own.
//
// THE MEDICAL PANEL IS NOT FOR EVERY RANK. A `bio.medical.view` row only exists
// when the subject HAS notes, so the panel is a list of burners who have
// disclosed a health condition — the same census the member roster refuses to
// carry. A rank that may not read personal information may not read it, and is
// TOLD so here rather than shown a mysteriously empty card. The rest of the
// trail still renders for them, minus the medical rows (lib/medical-audit.ts).

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;
  const { actor } = guard.session;

  const seesMedical = canReadMedicalAccessLog(actor);
  const [medical, trail] = await Promise.all([
    seesMedical ? getMedicalAccessLog(actor) : null,
    getAuditTrail(actor, 100),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Console / Audit"
        title="Audit log"
        description={
          seesMedical
            ? "Who did what, and when. Medical-notes reads are listed first because that is the record people ask about — not because anyone is being watched."
            : "Who did what, and when."
        }
      />

      <div className="flex flex-col gap-6">
        {medical ? (
          <MedicalAccessPanel log={medical} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
                Medical-notes reads
              </CardTitle>
              <CardDescription>
                {orgCapabilityRefusal(actor, "personal_information", "audit")}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              This panel names the burners whose medical notes were opened, and
              a row only exists when someone HAS notes — so the list itself
              would tell you who has disclosed a health condition. That is why
              it is withheld rather than blanked out.
            </CardContent>
          </Card>
        )}
        <AuditTrailList rows={trail} />
      </div>
    </div>
  );
}

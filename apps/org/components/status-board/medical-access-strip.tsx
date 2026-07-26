import Link from "next/link";
import { AlertTriangle, ArrowRight, Stethoscope } from "lucide-react";
import { Card, CardContent } from "@quagga/ui/components/card";

import type { MedicalAccessGlance } from "@/lib/medical-audit";
import { relativeTime } from "@/lib/status-board-format";

// The alert that did not exist. Medical reads are never blocked or rate-limited
// — by design, because an emergency read must not wait — so the ONLY control is
// that someone notices. A trail nobody looks at notices nothing, hence this
// strip: a standing count on the console landing page, and a loud state when
// the enumeration detector (@quagga/core `medical-audit.ts`) flags an actor who
// read many different burners' notes in one short window.

export function MedicalAccessStrip({ glance }: { glance: MedicalAccessGlance }) {
  const alerted = glance.alertCount > 0;

  return (
    <Card className={alerted ? "border-destructive/60 bg-destructive/5" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-base font-semibold">
            {alerted ? (
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
            ) : (
              <Stethoscope className="h-4 w-4 text-accent" aria-hidden />
            )}
            Medical-notes access
          </span>
          <p className="text-xs text-muted-foreground">
            {alerted
              ? `${glance.alertCount} account${glance.alertCount === 1 ? "" : "s"} read an unusual number of different burners' notes in a short window — check the audit log.`
              : glance.reads === 0
                ? `No medical notes have been opened in the last ${glance.lookbackDays} days.`
                : `${glance.reads} read${glance.reads === 1 ? "" : "s"} across ${glance.subjects} burner${glance.subjects === 1 ? "" : "s"} in the last ${glance.lookbackDays} days${glance.lastReadAt ? ` · last ${relativeTime(glance.lastReadAt)}` : ""}.`}
          </p>
        </div>
        <Link
          href="/audit"
          className={`inline-flex items-center gap-1 text-sm font-medium hover:underline ${alerted ? "text-destructive" : "text-accent"}`}
        >
          Audit log
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

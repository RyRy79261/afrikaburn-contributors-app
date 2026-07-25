import { CircleCheck, Eye, OctagonX, Lock, Mail } from "lucide-react";
import { Card, CardHeader } from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { cn } from "@quagga/ui/lib/utils";
import {
  standingDescription,
  standingLabel,
  standingTone,
  type SupplierStandingTone,
} from "@quagga/core";
import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

// Plain-language standing view per the canvas legend (R4wvO). Suppliers see only
// their standing verdict and what each standing means — the org-internal notes
// trail (infractions / blessings) is NEVER surfaced here. The positive standings
// (good / diligent_first_timer / adapting / absolute_beginner) all share the
// `success` tone and land on the GOOD legend row.
const TONE_META: Record<
  SupplierStandingTone,
  {
    icon: React.ReactNode;
    /** Badge word in the hero next to the standing name. */
    badge: string;
    text: string;
    ring: string;
    dot: string;
  }
> = {
  success: {
    icon: <CircleCheck className="h-7 w-7" aria-hidden />,
    badge: "Active",
    text: "text-success",
    ring: "border-success/40 bg-success/10",
    dot: "bg-success",
  },
  warning: {
    icon: <Eye className="h-7 w-7" aria-hidden />,
    badge: "Needs attention",
    text: "text-warning",
    ring: "border-warning/40 bg-warning/10",
    dot: "bg-warning",
  },
  destructive: {
    icon: <OctagonX className="h-7 w-7" aria-hidden />,
    badge: "Suspended",
    text: "text-destructive",
    ring: "border-destructive/40 bg-destructive/10",
    dot: "bg-destructive",
  },
};

// The three plain-language standing bands, in the canvas order.
const LEGEND: {
  tone: SupplierStandingTone;
  label: string;
  body: string;
}[] = [
  {
    tone: "success",
    label: "Good",
    body: "Approved and bookable. Creative projects see you as a supplier they can choose. Includes Diligent First Timer, Able & Willing To Adapt, and Absolute Beginners.",
  },
  {
    tone: "warning",
    label: "Watch",
    body: "You can still operate, but AfrikaBurn is keeping an eye on something. Creative projects see a subtle caution. Get in touch with the Supplier Team to clear it.",
  },
  {
    tone: "destructive",
    label: "Suspended",
    body: "You can't operate at the event and you won't appear to creative projects until this is resolved. Contact the Supplier Team.",
  },
];

export default async function StandingPage() {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const standing = session.supplier.standing;
  const tone = standingTone(standing);
  const meta = TONE_META[tone];

  return (
    <div>
      <PageHeading
        eyebrow="Your standing"
        title="Standing with AfrikaBurn"
        description="This is how AfrikaBurn's Supplier Team currently sees your account. Standing affects whether creative projects can select you."
      />

      {/* Standing hero — the supplier's own verdict, big and plain. */}
      <Card className={cn("border", meta.ring)}>
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
              meta.text,
            )}
          >
            {meta.icon}
          </span>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "text-lg font-semibold uppercase tracking-wide",
                  meta.text,
                )}
              >
                {standingLabel(standing)}
              </span>
              <Badge variant={tone}>{meta.badge}</Badge>
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              {standingDescription(standing)}
            </p>
          </div>
        </CardHeader>
      </Card>

      {/* What each standing means — the legend, with "you're here" on the
          band matching the supplier's current tone. */}
      <section className="mt-6">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          What each standing means
        </h2>
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {LEGEND.map((band) => {
            const here = band.tone === tone;
            const bandMeta = TONE_META[band.tone];
            return (
              <div
                key={band.label}
                className={cn(
                  "flex flex-col gap-1.5 p-4 sm:flex-row sm:gap-4",
                  here && "bg-primary/5",
                )}
              >
                <div className="flex w-40 shrink-0 items-center gap-2">
                  <span
                    className={cn("h-2.5 w-2.5 rounded-full", bandMeta.dot)}
                    aria-hidden
                  />
                  <span className="text-sm font-semibold uppercase tracking-wide text-foreground">
                    {band.label}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm text-muted-foreground">{band.body}</p>
                  {here && (
                    <Badge variant="outline" className="w-fit shrink-0">
                      You&apos;re here
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Private-notes callout — makes the #56 law visible: the org keeps an
          internal notes trail, and it is never shown to the supplier. */}
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-4">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            Private notes stay private
          </p>
          <p className="text-sm text-muted-foreground">
            AfrikaBurn keeps internal notes on every supplier to run the
            programme. Those notes are for the Supplier Team only — you&apos;ll
            never see them here.
          </p>
        </div>
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" aria-hidden />
        Questions about your standing? Email suppliers@afrikaburn.com — the
        Supplier Team can talk it through.
      </p>
    </div>
  );
}

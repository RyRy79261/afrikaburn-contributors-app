import { CircleCheck, Eye, OctagonX } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { cn } from "@quagga/ui/lib/utils";
import { standingDescription, standingLabel } from "@quagga/core";
import type { SupplierStanding } from "@quagga/types";
import { guardPortal } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

// Plain-language framing per standing. The org-internal notes trail
// (infractions / blessings) is NEVER surfaced here — suppliers see only their
// standing verdict and what it means for them.
const STANDING_META: Record<
  SupplierStanding,
  { icon: React.ReactNode; tone: string; ring: string }
> = {
  good: {
    icon: <CircleCheck className="h-6 w-6" aria-hidden />,
    tone: "text-success",
    ring: "border-success/40 bg-success/10",
  },
  watch: {
    icon: <Eye className="h-6 w-6" aria-hidden />,
    tone: "text-warning",
    ring: "border-warning/40 bg-warning/10",
  },
  suspended: {
    icon: <OctagonX className="h-6 w-6" aria-hidden />,
    tone: "text-destructive",
    ring: "border-destructive/40 bg-destructive/10",
  },
};

export default async function StandingPage() {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  const standing = session.supplier.standing;
  const meta = STANDING_META[standing] ?? STANDING_META.good;

  return (
    <div>
      <PageHeading
        eyebrow="Your standing"
        title="Standing with AfrikaBurn"
        description="This is how AfrikaBurn's Supplier Team currently sees your account. Standing affects whether creative projects can select you."
      />

      <Card className={cn("border", meta.ring)}>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <span className={meta.tone}>{meta.icon}</span>
          <CardTitle className="text-xl">{standingLabel(standing)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-foreground">
            {standingDescription(standing)}
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StandingLegend
          active={standing === "good"}
          label="Good standing"
          body="You appear normally to creative projects choosing suppliers."
          tone="text-success"
        />
        <StandingLegend
          active={standing === "watch"}
          label="Watch"
          body="You're flagged for attention but still selectable. Get in touch with the Supplier Team."
          tone="text-warning"
        />
        <StandingLegend
          active={standing === "suspended"}
          label="Suspended"
          body="You won't appear to creative projects until this is resolved."
          tone="text-destructive"
        />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Think this is wrong, or want to resolve a flag? Email
        suppliers@afrikaburn.com — the Supplier Team can talk it through.
      </p>
    </div>
  );
}

function StandingLegend({
  active,
  label,
  body,
  tone,
}: {
  active: boolean;
  label: string;
  body: string;
  tone: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-sm transition-colors",
        active ? "border-primary/50 bg-primary/5" : "border-border opacity-70",
      )}
    >
      <p className={cn("font-semibold", active ? tone : "text-foreground")}>
        {label}
      </p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

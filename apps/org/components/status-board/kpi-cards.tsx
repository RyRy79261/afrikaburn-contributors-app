import type { StatusBoardKpis } from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";

// The four headline entity cards (build-spec §"Status board KPI row"): BURNERS,
// CAMPS, MUTANT VEHICLES, ARTWORKS. Identical on the Overview and the Status
// Board — one component so the two pages can never disagree. Every number comes
// from `deriveStatusBoardKpis` over real rows; nothing here computes or guesses.

/** Brand dot colours from the canvas (teal / apricot / teal / sage). */
const DOT: Record<string, string> = {
  burners: "bg-ab-teal",
  camps: "bg-ab-apricot",
  mv: "bg-ab-teal",
  artworks: "bg-ab-sage",
};

function KpiCard({
  tone,
  kicker,
  value,
  sub,
}: {
  tone: keyof typeof DOT;
  kicker: string;
  value: number;
  sub: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`}
            aria-hidden
          />
          <span className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {kicker}
          </span>
        </div>
        <p className="text-3xl font-extrabold tabular-nums leading-none">
          {value}
        </p>
        <p className="text-xs font-medium text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ kpis }: { kpis: StatusBoardKpis }) {
  const { burners, camps, mutantVehicles, artworks } = kpis;
  return (
    <section
      aria-label="Edition headline numbers"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <KpiCard
        tone="burners"
        kicker="Burners"
        value={burners.total}
        sub={`${burners.complete} bios complete · ${burners.completePct}%`}
      />
      <KpiCard
        tone="camps"
        kicker="Camps"
        value={camps.total}
        sub={`${camps.registered} registered · ${camps.free} free camps`}
      />
      <KpiCard
        tone="mv"
        kicker="Mutant vehicles"
        value={mutantVehicles.total}
        sub={`${mutantVehicles.registered} registered · ${mutantVehicles.inReview} in review`}
      />
      <KpiCard
        tone="artworks"
        kicker="Artworks"
        value={artworks.total}
        sub={`${artworks.registered} registered · ${artworks.grantRequests} grant requests`}
      />
    </section>
  );
}

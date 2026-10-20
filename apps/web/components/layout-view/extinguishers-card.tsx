import { FireExtinguisher } from "lucide-react";
import {
  EXTINGUISHER_SIZE,
  GENERATOR_EXTINGUISHER_SIZE,
  type ExtinguisherEstimate,
} from "@quagga/core";

// The Extinguishers card (docs/registration-safety-spec.md §"Extinguisher
// count"; frames qi8us in the editor's inspector, fyfiX in the view-only
// plan). Worked out from the LIVE layout — layout only, never asked, nothing
// collected. No buckets of sand, ever (Ryan, 18 Oct 2026).

export function ExtinguishersCard({
  estimate,
  mode,
}: {
  estimate: ExtinguisherEstimate;
  /** "editor": recomputed as the camp draws; "view": from the plan. */
  mode: "editor" | "view";
}) {
  const area = (m2: number) => `${Math.round(m2)} m²`;
  return (
    <section
      aria-labelledby={`extinguishers-${mode}`}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-testid="extinguishers-card"
    >
      <h2
        id={`extinguishers-${mode}`}
        className="flex items-center gap-2 text-sm font-semibold normal-case tracking-normal"
      >
        <FireExtinguisher className="h-4 w-4 text-warning" aria-hidden />
        Fire extinguishers
      </h2>
      <p className="text-sm font-semibold" data-testid="extinguishers-total">
        {/* A generator and no structures: "1 × 1.5 kg", never "0 × 4.5 kg
            DCP + 1 × 1.5 kg". */}
        {estimate.units === 0 && estimate.generatorUnits > 0
          ? `${estimate.generatorUnits} × ${GENERATOR_EXTINGUISHER_SIZE}`
          : `${estimate.units} × ${EXTINGUISHER_SIZE}${
              estimate.generatorUnits > 0
                ? ` + ${estimate.generatorUnits} × ${GENERATOR_EXTINGUISHER_SIZE}`
                : ""
            }`}
      </p>
      <p className="text-xs text-muted-foreground">
        2 × {EXTINGUISHER_SIZE} for each 100 m², or part of 100 m², of every
        tent or shade structure (a 150 m² tent needs 4)
        {estimate.generators > 0
          ? `, and a ${GENERATOR_EXTINGUISHER_SIZE} one close by every generator`
          : ""}
        {estimate.rows.length > 0 ? ":" : "."}
      </p>
      {estimate.rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {estimate.rows.map((r) => (
            <li
              key={r.objectId}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <span className="min-w-0 truncate">
                {r.name}
                {r.kind === "structure" ? ` · ${area(r.areaM2)}` : ""}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {r.kind === "generator"
                  ? `${r.generatorUnits} × ${GENERATOR_EXTINGUISHER_SIZE}`
                  : r.units}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {mode === "editor" ? "Worked out as you draw." : "Worked out from the plan."}{" "}
        Extinguishers must be serviced; the Safety Officer checks them on site.
      </p>
    </section>
  );
}

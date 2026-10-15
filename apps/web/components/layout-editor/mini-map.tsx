import {
  boundaryRing,
  frontageSegment,
  nestedFootprintOnPlot,
  objectFootprint,
} from "@quagga/core";
import { bbox, footprintRing, type Ring } from "@quagga/geo";
import type { LayoutDocument } from "@quagga/types";

// The whole camp, small, with one shade structure highlighted — the context
// card under a covered area (frame LcZsE "Bedouin 1 on the whole camp").
// Plain SVG from the same metre document; no canvas.

/** A ring as an SVG `points` attribute, in metres. */
function points(ring: Ring): string {
  return ring.map(([x, y]) => `${x},${y}`).join(" ");
}

/** The whole camp as a small SVG with one shade structure highlighted. */
export function LayoutMiniMap({
  doc,
  highlightId,
  className,
}: {
  doc: LayoutDocument;
  highlightId: string | null;
  className?: string;
}) {
  const ring = boundaryRing(doc.plot.boundary);
  const frontage = frontageSegment(doc.plot);
  const b = bbox(ring);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04;
  const viewBox = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  return (
    <svg
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label="The whole camp, with this structure highlighted"
    >
      <polygon
        points={points(ring)}
        className="fill-background stroke-muted-foreground"
        strokeWidth={pad / 4}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={frontage[0][0]}
        y1={frontage[0][1]}
        x2={frontage[1][0]}
        y2={frontage[1][1]}
        className="stroke-ab-apricot"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {doc.plot.objects.map((o) => {
        const lit = o.id === highlightId;
        return (
          <g key={o.id}>
            <polygon
              points={points(footprintRing(objectFootprint(o)))}
              className={
                lit
                  ? "fill-primary/40 stroke-primary"
                  : "fill-muted/40 stroke-muted-foreground/60"
              }
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {lit &&
              o.child?.objects.map((c) => (
                <polygon
                  key={c.id}
                  points={points(
                    footprintRing(
                      nestedFootprintOnPlot({ ...o, child: o.child! }, c),
                    ),
                  )}
                  className="fill-primary/30 stroke-primary/70"
                  strokeWidth={0.75}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

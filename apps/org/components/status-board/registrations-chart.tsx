import { Card, CardContent } from "@quagga/ui/components/card";
import type { SeriesPoint } from "@/lib/status-board-format";

// Registrations over time — submissions per calendar month, straight from
// `registrations.submitted_at`. One series, so no legend box (the title names
// it); recessive grid; 2px line with an 8px marker per point carrying a native
// tooltip; a table view underneath so the numbers are readable without the
// plot. The page omits this card entirely when the series has fewer than two
// months — a chart is never drawn over invented points.

const W = 700;
const H = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

export function RegistrationsChart({ points }: { points: SeriesPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const step = points.length > 1 ? W / (points.length - 1) : W;

  const coords = points.map((p, i) => ({
    ...p,
    x: i * step,
    y: PAD_TOP + plotH - (p.count / max) * plotH,
  }));
  const line = coords
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const area = `${coords[0]!.x},${H} ${line} ${coords[coords.length - 1]!.x},${H}`;
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const span = `${points[0]!.label} – ${points[points.length - 1]!.label}`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Registrations over time</h2>
          <p className="text-xs text-muted-foreground">
            {span} · {total} submitted
          </p>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Registrations submitted per month, ${span}`}
            className="h-auto w-full min-w-[280px]"
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={PAD_TOP + plotH * f}
                y2={PAD_TOP + plotH * f}
                stroke="var(--color-border)"
                strokeWidth="1"
              />
            ))}
            <polygon points={area} fill="var(--color-ab-teal)" opacity="0.14" />
            <polyline
              points={line}
              fill="none"
              stroke="var(--color-ab-teal)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {coords.map((c) => (
              <circle
                key={c.key}
                cx={c.x}
                cy={c.y}
                r="4"
                fill="var(--color-ab-teal)"
                stroke="var(--color-card)"
                strokeWidth="2"
              >
                <title>{`${c.label}: ${c.count} submitted`}</title>
              </circle>
            ))}
          </svg>
        </div>

        <ul className="flex justify-between gap-1 text-[0.65rem] text-muted-foreground">
          {points.map((p) => (
            <li key={p.key} className="tabular-nums">
              <span className="block">{p.label}</span>
              <span className="block font-semibold text-foreground">
                {p.count}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

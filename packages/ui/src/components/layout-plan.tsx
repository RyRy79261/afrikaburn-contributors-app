import type { LayoutCatalogEntry } from "@quagga/core";
import type { LayoutDocument } from "@quagga/types";
import { cn } from "../lib/utils";
import {
  buildPlanLayout,
  planArea,
  textWidth,
  type PlanItem,
  type PlanShape,
  type PlanTone,
} from "../lib/layout-plan-model";
import { layoutIcon } from "./layout-icons";

// THE READ-ONLY PLAN (docs/camp-layout-spec.md §Surfaces; frame L3 QZeG7 /
// t7aOZ3). Plain SVG, rendered on the server, from the same metre document
// the editor writes: the member view, the phone view, the print page, the
// camp tile's thumbnail and the org console's snapshot all draw it. No
// canvas library — Konva is the editor's alone.
//
// NO WARNINGS, BY CONSTRUCTION. This component is never given any: it
// reaches plain members and AfrikaBurn's reviewers, and warnings are for
// the camp's editors only (14 Oct decision).
//
// Colours are the brand ramp (ab-teal, ab-apricot, ab-sage), not `primary`,
// so the plan reads the same in the org console, whose primary is apricot.

/** The drawing's fill and stroke per tone. Literal class strings, so
 * Tailwind generates every one. */
export const PLAN_TONE_CLASSES: Record<
  PlanTone,
  { shape: string; text: string; swatch: string }
> = {
  shelter: {
    shape: "fill-ab-teal/20 stroke-ab-teal",
    text: "text-ab-teal",
    swatch: "border-ab-teal bg-ab-teal/20",
  },
  infrastructure: {
    shape: "fill-ab-apricot/20 stroke-ab-apricot",
    text: "text-ab-apricot",
    swatch: "border-ab-apricot bg-ab-apricot/20",
  },
  vehicle: {
    shape: "fill-muted-foreground/15 stroke-muted-foreground",
    text: "text-muted-foreground",
    swatch: "border-muted-foreground bg-muted-foreground/15",
  },
  safety: {
    shape: "fill-destructive/25 stroke-destructive",
    text: "text-destructive",
    swatch: "border-destructive bg-destructive/25",
  },
  area: {
    shape: "fill-ab-sage/20 stroke-ab-sage",
    text: "text-ab-sage",
    swatch: "border-ab-sage bg-ab-sage/20",
  },
  pole: {
    shape: "fill-foreground stroke-foreground",
    text: "text-foreground",
    swatch: "border-foreground bg-foreground",
  },
};

export const PLAN_TONE_LABELS: Record<PlanTone, string> = {
  shelter: "Shelter and shade",
  infrastructure: "Kitchen, stage and services",
  vehicle: "Vehicles and storage",
  safety: "Fire and safety",
  area: "Paths and areas",
  pole: "Support poles",
};

export type LayoutPlanVariant = "full" | "compact" | "thumb";

export interface LayoutPlanProps {
  doc: LayoutDocument;
  catalog: readonly LayoutCatalogEntry[];
  /** Null or absent: the whole camp. A shade structure's id: its covered
   * area. An id that names none draws nothing. */
  areaId?: string | null;
  /** `full`: rulers, labels with sizes, scale bar. `compact`: labels and
   * icons, no rulers (phones). `thumb`: shapes only (the camp tile). */
  variant: LayoutPlanVariant;
  /** Accessible name. */
  title: string;
  /** The <svg> element's id — the PNG export finds the drawing by it, and
   * the clip path is named after it. */
  id: string;
  className?: string;
  /** Shade structures with a covered area get a "N inside · open" chip
   * linking here. Absent: no chip (the org snapshot, print). */
  openHref?: (objectId: string) => string;
  /** Objects drawn with the warning outline. ONLY an editor's phone view
   * passes this (frames vnpZw, PGk6q): warnings are for the camp's editors,
   * so a member's plan, print, the PNG and the org snapshot never do. */
  highlightIds?: ReadonlySet<string>;
}

function Shape({
  shape,
  className,
  strokeWidth,
  dash,
}: {
  shape: PlanShape;
  className: string;
  strokeWidth: number;
  dash?: string;
}) {
  return shape.kind === "circle" ? (
    <circle
      cx={shape.cx}
      cy={shape.cy}
      r={shape.r}
      className={className}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
    />
  ) : (
    <polygon
      points={shape.points}
      className={className}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      strokeLinejoin="round"
    />
  );
}

function chipText(count: number): string {
  return `${count} inside · open ›`;
}

function ItemText({
  item,
  fontPx,
  variant,
}: {
  item: PlanItem;
  fontPx: number;
  variant: LayoutPlanVariant;
}) {
  if (variant === "thumb") return null;
  const [cx, cy] = item.centre;
  const tone = PLAN_TONE_CLASSES[item.tone];
  const fit = variant === "compact" && item.fit === "full" ? "name" : item.fit;
  if (fit === "full") {
    return (
      <g aria-hidden>
        <text
          x={cx}
          y={cy - fontPx * 0.2}
          textAnchor="middle"
          className="fill-foreground font-sans font-semibold"
          fontSize={fontPx}
        >
          {item.name}
        </text>
        <text
          x={cx}
          y={cy + fontPx * 1.05}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize={fontPx * 0.85}
        >
          {item.dims}
        </text>
      </g>
    );
  }
  if (fit === "name") {
    return (
      <text
        aria-hidden
        x={cx}
        y={cy + fontPx * 0.35}
        textAnchor="middle"
        className="fill-foreground font-sans font-semibold"
        fontSize={fontPx}
      >
        {item.name}
      </text>
    );
  }
  if (fit === "icon" && item.tone !== "pole") {
    const Icon = layoutIcon(item.icon);
    const s = Math.min(fontPx * 1.3, Math.min(item.boxW, item.boxH) * 0.7);
    return (
      <Icon
        aria-hidden
        x={cx - s / 2}
        y={cy - s / 2}
        width={s}
        height={s}
        size={s}
        className={tone.text}
      />
    );
  }
  return null;
}

/** The read-only plan, as an <svg>. */
export function LayoutPlan({
  doc,
  catalog,
  areaId = null,
  variant,
  title,
  id,
  className,
  openHref,
  highlightIds,
}: LayoutPlanProps) {
  const src = planArea(doc, areaId);
  if (!src) return null;
  const full = variant === "full";
  // A phone shows the drawing about 300 px wide, so its labels are drawn
  // larger against the plot; fewer fit, and the rest become icons.
  const plan = buildPlanLayout(src, catalog, {
    rulers: full,
    scaleBar: full,
    // Inside a shade structure the guy-rope band shrinks the drawing, so
    // its labels are set a little smaller to keep tent names (frame PGk6q).
    fontPx: variant === "compact" ? (src.parent ? 26 : 30) : 13,
  });
  const f = plan.fontPx;
  const clipId = `${id}-clip`;
  const a = plan.areaBox;
  const hairline = variant === "thumb" ? 1.5 : 1;

  return (
    <svg
      id={id}
      viewBox={`0 0 ${plan.width} ${plan.height}`}
      role="img"
      aria-label={title}
      className={cn("block h-auto w-full select-none", className)}
      xmlns="http://www.w3.org/2000/svg"
      data-layout-plan=""
    >
      <title>{title}</title>
      <defs>
        <clipPath id={clipId}>
          <polygon points={plan.outline} />
        </clipPath>
      </defs>

      {/* Inside a shade structure: where its guy ropes run, under the
          ground (frames LcZsE, PGk6q). */}
      {plan.guyZone && (
        <g aria-hidden>
          <polygon
            points={plan.guyZone.points}
            className="fill-ab-apricot/10 stroke-ab-apricot/60"
            strokeWidth={hairline * Math.max(1, f / 13)}
            strokeDasharray={`${f * 0.5} ${f * 0.4}`}
          />
          {full && (
            <text
              x={plan.guyZone.x + f * 0.6}
              y={plan.guyZone.y + f * 1.3}
              className="fill-ab-apricot font-mono font-semibold"
              fontSize={f * 0.8}
            >
              {`GUY ROPES · KEEP CLEAR · ${plan.guyZone.clearanceM} m (estimate)`}
            </text>
          )}
        </g>
      )}

      {/* The ground, then the metre grid inside the outline. */}
      <polygon points={plan.outline} className="fill-muted/50" />
      <g clipPath={`url(#${clipId})`}>
        {plan.gridMinor.xs.map((x) => (
          <line
            key={`mx${x}`}
            x1={x}
            x2={x}
            y1={a.y}
            y2={a.y + a.h}
            className="stroke-muted-foreground/10"
            strokeWidth={1}
          />
        ))}
        {plan.gridMinor.ys.map((y) => (
          <line
            key={`my${y}`}
            y1={y}
            y2={y}
            x1={a.x}
            x2={a.x + a.w}
            className="stroke-muted-foreground/10"
            strokeWidth={1}
          />
        ))}
        {plan.gridMajor.xs.map((x) => (
          <line
            key={`Mx${x}`}
            x1={x}
            x2={x}
            y1={a.y}
            y2={a.y + a.h}
            className="stroke-muted-foreground/30"
            strokeWidth={1}
          />
        ))}
        {plan.gridMajor.ys.map((y) => (
          <line
            key={`My${y}`}
            y1={y}
            y2={y}
            x1={a.x}
            x2={a.x + a.w}
            className="stroke-muted-foreground/30"
            strokeWidth={1}
          />
        ))}
      </g>
      <polygon
        points={plan.outline}
        className={cn(
          "fill-none",
          src.parent ? "stroke-ab-teal" : "stroke-muted-foreground",
        )}
        strokeWidth={src.parent ? 2.5 : 2}
        strokeDasharray={src.parent ? "8 5" : undefined}
      />
      {plan.frontage && (
        <line
          {...plan.frontage}
          className="stroke-ab-apricot"
          // In viewBox units: the compact drawing is drawn larger against
          // the plot (fontPx 30), so its frontage is thickened to match —
          // otherwise it shrinks to a hairline at 360 (frame vnpZw).
          strokeWidth={4 * Math.max(1, f / 13)}
          strokeLinecap="round"
        />
      )}

      {/* Safety zones under everything they surround. */}
      {plan.items.map(
        (it) =>
          it.safety && (
            <Shape
              key={`halo-${it.id}`}
              shape={it.safety}
              className="fill-destructive/10 stroke-destructive/45"
              strokeWidth={hairline}
            />
          ),
      )}

      {plan.items.map((it) => (
        <g key={it.id} data-object-id={it.id}>
          <Shape
            shape={it.shape}
            className={cn(
              PLAN_TONE_CLASSES[it.tone].shape,
              highlightIds?.has(it.id) && "stroke-ab-apricot",
            )}
            strokeWidth={
              highlightIds?.has(it.id)
                ? 2.5 * Math.max(1, f / 13)
                : variant === "thumb"
                  ? 2
                  : 1.5
            }
          />
          <ItemText item={it} fontPx={f} variant={variant} />
        </g>
      ))}

      {/* "7 inside · open ›" on each shade structure that has a covered
          area — a link into it, where the caller gives one. */}
      {openHref &&
        variant !== "thumb" &&
        plan.items.map((it) => {
          if (it.nestedCount === null) return null;
          const text = chipText(it.nestedCount);
          const fs = f * 0.85;
          const w = textWidth(text, fs) + fs * 1.4;
          const h = fs * 1.7;
          if (w > it.boxW || it.boxH < f * 4.6) return null;
          const [cx, cy] = it.centre;
          const y = cy + f * 1.6;
          return (
            <a
              key={`chip-${it.id}`}
              href={openHref(it.id)}
              aria-label={`Open ${it.name}: ${it.nestedCount} inside`}
            >
              <rect
                x={cx - w / 2}
                y={y}
                width={w}
                height={h}
                rx={h / 2}
                className="fill-ab-teal/60"
              />
              <text
                x={cx}
                y={y + h * 0.68}
                textAnchor="middle"
                className="fill-foreground font-sans font-semibold"
                fontSize={fs}
              >
                {text}
              </text>
            </a>
          );
        })}

      {plan.rulers && (
        <g aria-hidden className="fill-muted-foreground font-mono">
          {plan.rulers.x.map((t) => (
            <text
              key={`rx${t.at}`}
              x={t.at}
              y={16}
              textAnchor="middle"
              fontSize={f * 0.85}
            >
              {t.label}
            </text>
          ))}
          {plan.rulers.y.map((t) => (
            <text
              key={`ry${t.at}`}
              x={26}
              y={t.at + f * 0.3}
              textAnchor="end"
              fontSize={f * 0.85}
            >
              {t.label}
            </text>
          ))}
        </g>
      )}

      {plan.scaleBar && (
        <g aria-hidden>
          <rect
            x={plan.scaleBar.x}
            y={plan.scaleBar.y}
            width={plan.scaleBar.px}
            height={7}
            className="fill-none stroke-foreground"
            strokeWidth={1}
          />
          <rect
            x={plan.scaleBar.x}
            y={plan.scaleBar.y}
            width={plan.scaleBar.px / 2}
            height={7}
            className="fill-foreground"
          />
          <text
            x={plan.scaleBar.x}
            y={plan.scaleBar.y + 7 + f * 1.1}
            className="fill-muted-foreground font-mono"
            fontSize={f * 0.85}
          >
            0
          </text>
          <text
            x={plan.scaleBar.x + plan.scaleBar.px}
            y={plan.scaleBar.y + 7 + f * 1.1}
            textAnchor="end"
            className="fill-muted-foreground font-mono"
            fontSize={f * 0.85}
          >
            {`${plan.scaleBar.metres} m`}
          </text>
          {plan.frontage && (
            <g>
              <line
                x1={plan.width - 96}
                x2={plan.width - 80}
                y1={plan.scaleBar.y + 4}
                y2={plan.scaleBar.y + 4}
                className="stroke-ab-apricot"
                strokeWidth={3}
              />
              <text
                x={plan.width - 74}
                y={plan.scaleBar.y + 4 + f * 0.35}
                className="fill-muted-foreground font-sans"
                fontSize={f * 0.85}
              >
                Frontage
              </text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}

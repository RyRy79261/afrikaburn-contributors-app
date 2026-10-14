"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  Circle,
  Group,
  Label,
  Layer,
  Line,
  Rect,
  Stage,
  Tag,
  Text,
  Transformer,
} from "react-konva";
import {
  findCatalogEntry,
  layoutObjectName,
  objectFootprint,
  type LayoutCatalogEntry,
} from "@quagga/core";
import {
  bbox,
  footprintRing,
  inflate,
  SNAP_ANGLE_DEG,
  SNAP_LENGTH_M,
  type BBox,
  type Ring,
  type Vec,
} from "@quagga/geo";
import {
  dimsText,
  fitScale,
  rulerStep,
  sizeReadout,
  snapCentre,
  type AnyLayoutObject,
} from "@/lib/layout-editor-model";
import { PALETTE_DRAG_TYPE } from "./palette-drag";

// THE CANVAS (react-konva). This is the ONLY module that imports Konva, and
// it is loaded with next/dynamic({ ssr: false }) from the editor, so the
// library reaches the browser on /camps/[slug]/layout only.
//
// Konva draws and hands back positions; it decides nothing. Every position it
// reports is converted to METRES here and snapped by @/lib/layout-editor-model
// (in metres, never pixels — the same 0.5 m at every zoom). The document is
// never a Konva type: on a transform the Transformer's scale is folded back
// into width and length and the node's scale reset to 1, so the stored
// document only ever holds metres.
//
// THE VIEW. screen = pan + metres × scale, with x along the frontage and y
// into the depth (y down on screen; a positive rotation turns clockwise —
// the same convention as @quagga/geo). Ctrl/⌘ + wheel (and a trackpad pinch)
// zooms about the pointer; dragging the empty ground pans.

export interface StageTheme {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  accent: string;
  destructive: string;
  sage: string;
  font: string;
  mono: string;
}

export interface StageApi {
  /** A PNG of the whole area, fitted, without the selection handles. */
  exportPng: () => Promise<string | null>;
}

export interface EditorStageProps {
  objects: readonly AnyLayoutObject[];
  ring: Ring;
  level: "plot" | "nested";
  catalog: readonly LayoutCatalogEntry[];
  selectedId: string | null;
  warnedIds: ReadonlySet<string>;
  snap: boolean;
  zoom: number;
  /** Bumped by "Fit" and when the area changes: recentre at zoom 1. */
  fitKey: string;
  frontage: readonly [Vec, Vec] | null;
  /** Inside a covered area: the structure's outer footprint plus its
   * clearance — where the guy ropes run. */
  guyZone: { ring: Ring; clearanceM: number } | null;
  /** Shade structures on the whole camp: how many things are under each. */
  nestedCounts: ReadonlyMap<string, number>;
  theme: StageTheme;
  height: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, centre: Vec) => void;
  onTransform: (
    id: string,
    next: { centre: Vec; width: number; length: number; rotationDeg: number },
  ) => void;
  onOpen: (id: string) => void;
  onDropEntry: (key: string, centre: Vec) => void;
  onZoom: (zoom: number) => void;
  onReady: (api: StageApi) => void;
}


const RULER = 24;
const MARGIN = 28;

export function withAlpha(colour: string, alpha: number): string {
  const hex = colour.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return colour;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** An estimate of a one-line chip's width, to centre it: Konva measures
 * text only once it is drawn. */
function chipWidth(text: string, charPx: number, padding: number): number {
  return text.length * charPx + 2 * padding;
}

function openText(count: number): string {
  return count > 0 ? `${count} inside · open ›` : "Open inside ›";
}

function ringPoints(ring: Ring, scale: number): number[] {
  return ring.flatMap(([x, y]) => [x * scale, y * scale]);
}

function unionBox(a: BBox, b: BBox | null): BBox {
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function colourFor(
  e: LayoutCatalogEntry | undefined,
  theme: StageTheme,
): string {
  if (!e) return theme.muted;
  if (e.role === "pole") return theme.foreground;
  if (e.role === "path" || e.role === "area" || e.role === "entrance") {
    return theme.sage;
  }
  switch (e.group) {
    case "vehicles":
      return theme.muted;
    case "infrastructure":
      return theme.accent;
    case "safety":
      return theme.destructive;
    case "areas":
      return theme.sage;
    default:
      return theme.primary;
  }
}

export default function EditorStage(props: EditorStageProps) {
  const {
    objects,
    ring,
    level,
    catalog,
    selectedId,
    warnedIds,
    snap,
    zoom,
    fitKey,
    frontage,
    guyZone,
    nestedCounts,
    theme,
    height,
    onSelect,
    onMove,
    onTransform,
    onOpen,
    onDropEntry,
    onZoom,
    onReady,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const worldRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [width, setWidth] = useState(800);
  const [pan, setPan] = useState<Vec>([RULER + MARGIN, RULER + MARGIN]);
  const [hideChrome, setHideChrome] = useState(false);
  const [live, setLive] = useState<{ id: string; text: string } | null>(null);

  const box = useMemo(
    () => unionBox(bbox(ring), guyZone ? bbox(guyZone.ring) : null),
    [ring, guyZone],
  );
  const base = fitScale(
    box.maxX - box.minX,
    box.maxY - box.minY,
    width - RULER,
    height - RULER,
    MARGIN,
  );
  const scale = base * zoom;

  // Container width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const prevScale = useRef(scale);
  const anchor = useRef<Vec | null>(null);

  // Fit: centre the area in the viewport. Runs on "Fit", on opening another
  // area, and when the viewport is resized.
  const centreAt = useCallback(
    (s: number): Vec => {
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      return [
        RULER + (width - RULER) / 2 - cx * s,
        RULER + (height - RULER) / 2 - cy * s,
      ];
    },
    [box, width, height],
  );
  useLayoutEffect(() => {
    setPan(centreAt(base));
    // The fit IS the new view: the zoom-anchor effect below must not move it
    // a second time for the scale change that came with it.
    prevScale.current = base * zoom;
  }, [fitKey, width, height]);

  // Zoom from the toolbar keeps the middle of the view still; a wheel zoom
  // keeps the point under the pointer still (it sets `anchor` first).
  useLayoutEffect(() => {
    const old = prevScale.current;
    prevScale.current = scale;
    if (old === scale) return;
    const a: Vec = anchor.current ?? [
      RULER + (width - RULER) / 2,
      RULER + (height - RULER) / 2,
    ];
    anchor.current = null;
    setPan(([px, py]) => [
      a[0] - ((a[0] - px) / old) * scale,
      a[1] - ((a[1] - py) / old) * scale,
    ]);
  }, [scale]);

  // Attach the handles to the selected object.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodes.current.get(selectedId) : undefined;
    tr.nodes(node && !hideChrome ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, objects, hideChrome, scale]);

  const toMetres = useCallback(
    (abs: { x: number; y: number }): Vec => {
      const w = worldRef.current?.absolutePosition() ?? { x: pan[0], y: pan[1] };
      return [(abs.x - w.x) / scale, (abs.y - w.y) / scale];
    },
    [pan, scale],
  );

  // The export: fit, hide the handles, draw, read, restore.
  const viewRef = useRef({ pan, zoom, base });
  viewRef.current = { pan, zoom, base };
  useEffect(() => {
    onReady({
      exportPng: async () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const saved = viewRef.current.pan;
        const needsFit = viewRef.current.zoom !== 1;
        if (needsFit) onZoom(1);
        setHideChrome(true);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        setPan(centreAt(viewRef.current.base));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const url = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
        setHideChrome(false);
        if (!needsFit) setPan(saved);
        return url;
      },
    });
  }, [onReady, onZoom, centreAt]);

  const step = rulerStep(scale);
  const minor = (step / 5) * scale >= 6 ? step / 5 : null;
  const areaBox = bbox(ring);

  const grid = useMemo(() => {
    const lines: { key: string; points: number[]; major: boolean }[] = [];
    const push = (v: number, vertical: boolean, major: boolean) => {
      lines.push({
        key: `${vertical ? "v" : "h"}${v}`,
        major,
        points: vertical
          ? [v * scale, areaBox.minY * scale, v * scale, areaBox.maxY * scale]
          : [areaBox.minX * scale, v * scale, areaBox.maxX * scale, v * scale],
      });
    };
    const each = (min: number, max: number, s: number, cb: (v: number) => void) => {
      for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) {
        cb(Number(v.toFixed(6)));
      }
    };
    const unit = minor ?? step;
    each(areaBox.minX, areaBox.maxX, unit, (v) =>
      push(v, true, Math.abs(v / step - Math.round(v / step)) < 1e-6),
    );
    each(areaBox.minY, areaBox.maxY, unit, (v) =>
      push(v, false, Math.abs(v / step - Math.round(v / step)) < 1e-6),
    );
    return lines;
  }, [areaBox.minX, areaBox.minY, areaBox.maxX, areaBox.maxY, scale, step, minor]);

  const rulerTicks = (axis: "x" | "y") => {
    const len = axis === "x" ? width : height;
    const p = axis === "x" ? pan[0] : pan[1];
    const from = Math.ceil((RULER - p) / scale / step) * step;
    const to = (len - p) / scale;
    const ticks: number[] = [];
    for (let v = from; v <= to && ticks.length < 200; v += step) {
      ticks.push(Number(v.toFixed(6)));
    }
    return ticks;
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!e.evt.ctrlKey && !e.evt.metaKey) return;
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (pointer) anchor.current = [pointer.x, pointer.y];
    const factor = Math.exp(-e.evt.deltaY * 0.002);
    onZoom(Math.min(8, Math.max(0.25, Number((zoom * factor).toFixed(4)))));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const key = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
    const stage = stageRef.current;
    if (!key || !stage) return;
    e.preventDefault();
    stage.setPointersPositions(e.nativeEvent);
    const pos = stage.getPointerPosition();
    if (pos) onDropEntry(key, toMetres(pos));
  };

  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const scaleBarM = rulerStep(scale, 60);

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-lg"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleDrop}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onWheel={handleWheel}
      >
        <Layer>
          <Group
            ref={worldRef}
            x={pan[0]}
            y={pan[1]}
            draggable
            onDragMove={(e) => {
              const w = worldRef.current;
              if (w && (e.target as Konva.Node) === w) setPan([w.x(), w.y()]);
            }}
            onDragEnd={(e) => {
              const w = worldRef.current;
              if (w && (e.target as Konva.Node) === w) setPan([w.x(), w.y()]);
            }}
          >
            {/* The ground: catches clicks (deselect) and drags (pan). */}
            <Rect
              x={-pan[0]}
              y={-pan[1]}
              width={width}
              height={height}
              fill={theme.card}
              onClick={() => onSelect(null)}
              onTap={() => onSelect(null)}
            />

            {guyZone && (
              <Group listening={false}>
                <Line
                  points={ringPoints(guyZone.ring, scale)}
                  closed
                  fill={withAlpha(theme.accent, 0.08)}
                  stroke={withAlpha(theme.accent, 0.5)}
                  strokeWidth={1}
                  dash={[6, 4]}
                />
                <Text
                  x={bbox(guyZone.ring).minX * scale + 8}
                  y={bbox(guyZone.ring).minY * scale + 8}
                  text={`GUY ROPES · KEEP CLEAR · ${guyZone.clearanceM} m (estimate)`}
                  fontFamily={theme.font}
                  fontSize={11}
                  fontStyle="bold"
                  letterSpacing={0.8}
                  fill={theme.accent}
                />
              </Group>
            )}

            <Line
              points={ringPoints(ring, scale)}
              closed
              fill={theme.background}
              listening={false}
            />
            {grid.map((g) => (
              <Line
                key={g.key}
                points={g.points}
                stroke={withAlpha(theme.muted, g.major ? 0.3 : 0.12)}
                strokeWidth={1}
                listening={false}
              />
            ))}
            <Line
              points={ringPoints(ring, scale)}
              closed
              stroke={level === "nested" ? theme.primary : theme.muted}
              strokeWidth={level === "nested" ? 2 : 1.5}
              listening={false}
            />
            {frontage && (
              <Line
                points={[
                  frontage[0][0] * scale,
                  frontage[0][1] * scale,
                  frontage[1][0] * scale,
                  frontage[1][1] * scale,
                ]}
                stroke={theme.accent}
                strokeWidth={3}
                listening={false}
              />
            )}

            {/* Halos under everything: safety (red) and clearance (dashed). */}
            {objects.map((o) => {
              const fp = objectFootprint(o);
              return (
                <Group key={`halo-${o.id}`} listening={false}>
                  {o.safetyM > 0 && (
                    <Line
                      points={ringPoints(footprintRing(inflate(fp, o.safetyM), 48), scale)}
                      closed
                      fill={withAlpha(theme.destructive, 0.08)}
                      stroke={withAlpha(theme.destructive, 0.45)}
                      strokeWidth={1}
                    />
                  )}
                  {o.clearanceM > 0 && level === "plot" && (
                    <Line
                      points={ringPoints(footprintRing(inflate(fp, o.clearanceM), 48), scale)}
                      closed
                      stroke={withAlpha(theme.muted, 0.45)}
                      strokeWidth={1}
                      dash={[4, 4]}
                    />
                  )}
                </Group>
              );
            })}

            {objects.map((o) => {
              const e = findCatalogEntry(catalog, o.catalogKey);
              const colour = colourFor(e, theme);
              const warned = warnedIds.has(o.id);
              const isSel = o.id === selectedId;
              const w = (o.shape === "circle" ? (o.diameter ?? o.width) : o.width) * scale;
              const l = (o.shape === "circle" ? (o.diameter ?? o.width) : o.length) * scale;
              const name = layoutObjectName(o, catalog);
              const showText = w >= 34 && l >= 18;
              const showDims = w >= 44 && l >= 34;
              const nested = e?.nestable ? (nestedCounts.get(o.id) ?? 0) : null;
              const stroke = warned ? theme.accent : colour;
              const fill =
                e?.role === "pole" ? theme.foreground : withAlpha(colour, e?.role === "path" ? 0.22 : 0.16);
              return (
                <Group
                  key={o.id}
                  ref={(node) => {
                    if (node) nodes.current.set(o.id, node);
                    else nodes.current.delete(o.id);
                  }}
                  name={o.id}
                  x={o.centre[0] * scale}
                  y={o.centre[1] * scale}
                  rotation={o.shape === "circle" ? 0 : o.rotationDeg}
                  draggable
                  onMouseDown={() => onSelect(o.id)}
                  onTouchStart={() => onSelect(o.id)}
                  onDblClick={() => nested !== null && onOpen(o.id)}
                  onDblTap={() => nested !== null && onOpen(o.id)}
                  dragBoundFunc={(pos) => {
                    if (!snap) return pos;
                    const m = toMetres(pos);
                    const s = snapCentre(o, m, SNAP_LENGTH_M);
                    const wp = worldRef.current?.absolutePosition() ?? { x: pan[0], y: pan[1] };
                    return { x: wp.x + s[0] * scale, y: wp.y + s[1] * scale };
                  }}
                  onDragMove={(ev) => {
                    const node = ev.target;
                    const m: Vec = [node.x() / scale, node.y() / scale];
                    setLive({ id: o.id, text: `${m[0].toFixed(1)} m, ${m[1].toFixed(1)} m` });
                  }}
                  onDragEnd={(ev) => {
                    const node = ev.target;
                    const m: Vec = [node.x() / scale, node.y() / scale];
                    const s = snapCentre(o, m, snap ? SNAP_LENGTH_M : 0);
                    node.position({ x: s[0] * scale, y: s[1] * scale });
                    setLive(null);
                    onMove(o.id, s);
                  }}
                  onTransform={(ev) => {
                    const node = ev.target;
                    const rotating = trRef.current?.getActiveAnchor() === "rotater";
                    const nw = (w * node.scaleX()) / scale;
                    const nl = (l * node.scaleY()) / scale;
                    setLive({
                      id: o.id,
                      text: rotating
                        ? `${Math.round(((node.rotation() % 360) + 360) % 360)}°`
                        : sizeReadout(o.shape, nw, nl),
                    });
                  }}
                  onTransformEnd={(ev) => {
                    const node = ev.target;
                    let nw = (w * node.scaleX()) / scale;
                    let nl = (l * node.scaleY()) / scale;
                    let rot = ((node.rotation() % 360) + 360) % 360;
                    if (snap) {
                      nw = Math.max(SNAP_LENGTH_M, Math.round(nw / SNAP_LENGTH_M) * SNAP_LENGTH_M);
                      nl = Math.max(SNAP_LENGTH_M, Math.round(nl / SNAP_LENGTH_M) * SNAP_LENGTH_M);
                      rot = Math.round(rot / SNAP_ANGLE_DEG) * SNAP_ANGLE_DEG;
                    }
                    if (o.shape === "circle") nl = nw;
                    node.scaleX(1);
                    node.scaleY(1);
                    if (o.shape === "rect") node.rotation(rot % 360);
                    let centre: Vec = [node.x() / scale, node.y() / scale];
                    const next = { ...o, width: nw, length: nl, diameter: nw, rotationDeg: rot % 360 };
                    centre = snapCentre(next, centre, snap ? SNAP_LENGTH_M / 2 : 0);
                    node.position({ x: centre[0] * scale, y: centre[1] * scale });
                    setLive(null);
                    onTransform(o.id, { centre, width: nw, length: nl, rotationDeg: rot % 360 });
                  }}
                >
                  {o.shape === "circle" ? (
                    <Circle
                      radius={w / 2}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSel || warned ? 2 : 1.5}
                    />
                  ) : (
                    <Rect
                      x={-w / 2}
                      y={-l / 2}
                      width={w}
                      height={l}
                      cornerRadius={Math.min(4, w / 4, l / 4)}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSel || warned ? 2 : 1.5}
                    />
                  )}
                  {showText && e?.role !== "pole" && (
                    <Text
                      x={-w / 2}
                      y={showDims ? -15 - (nested !== null ? 8 : 0) : -7}
                      width={w}
                      align="center"
                      text={name}
                      fontFamily={theme.font}
                      fontSize={12}
                      fontStyle="600"
                      fill={theme.foreground}
                      ellipsis
                      wrap="none"
                      listening={false}
                    />
                  )}
                  {showDims && e?.role !== "pole" && (
                    <Text
                      x={-w / 2}
                      y={2 - (nested !== null ? 8 : 0)}
                      width={w}
                      align="center"
                      text={dimsText(o)}
                      fontFamily={theme.mono}
                      fontSize={10}
                      fill={withAlpha(theme.foreground, 0.65)}
                      wrap="none"
                      listening={false}
                    />
                  )}
                  {nested !== null && w >= 90 && l >= 60 && (
                    <Label
                      x={0}
                      y={18}
                      offsetX={chipWidth(openText(nested), 6.2, 4) / 2}
                      onClick={() => onOpen(o.id)}
                      onTap={() => onOpen(o.id)}
                    >
                      <Tag fill={withAlpha(theme.primary, 0.45)} cornerRadius={9} />
                      <Text
                        text={openText(nested)}
                        fontFamily={theme.font}
                        fontSize={11}
                        fontStyle="600"
                        padding={4}
                        fill={theme.foreground}
                      />
                    </Label>
                  )}
                </Group>
              );
            })}

            <Transformer
              ref={trRef}
              rotateEnabled={selected?.shape === "rect"}
              keepRatio={selected?.shape === "circle"}
              enabledAnchors={
                selected?.shape === "circle"
                  ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                  : undefined
              }
              rotationSnaps={snap ? Array.from({ length: 24 }, (_, i) => i * 15) : []}
              rotationSnapTolerance={snap ? 7.5 : 0}
              anchorSize={8}
              anchorStroke={theme.primary}
              anchorFill={theme.foreground}
              borderStroke={theme.primary}
              flipEnabled={false}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) =>
                Math.abs(newBox.width) < 0.1 * scale || Math.abs(newBox.height) < 0.1 * scale
                  ? oldBox
                  : newBox
              }
            />

            {/* The live metre readout on the handles (and the selected
                object's size when idle). */}
            {selected && !hideChrome && (() => {
              const fp = objectFootprint(selected);
              const b = bbox(footprintRing(fp));
              const text =
                live?.id === selected.id
                  ? live.text
                  : sizeReadout(selected.shape, selected.diameter ?? selected.width, selected.shape === "circle" ? (selected.diameter ?? selected.width) : selected.length);
              return (
                <Label
                  x={((b.minX + b.maxX) / 2) * scale}
                  y={b.maxY * scale + 8}
                  offsetX={chipWidth(text, 7.4, 5) / 2}
                  listening={false}
                >
                  <Tag fill={theme.primary} cornerRadius={4} />
                  <Text
                    text={text}
                    fontFamily={theme.mono}
                    fontSize={12}
                    fontStyle="bold"
                    padding={5}
                    fill="#ffffff"
                  />
                </Label>
              );
            })()}
          </Group>
        </Layer>

        {/* Rulers and the scale bar sit on the screen, not the ground. */}
        <Layer listening={false}>
          <Rect x={0} y={0} width={width} height={RULER} fill={theme.card} />
          <Rect x={0} y={0} width={RULER} height={height} fill={theme.card} />
          {rulerTicks("x").map((v) => (
            <Text
              key={`rx${v}`}
              x={pan[0] + v * scale - 20}
              y={6}
              width={40}
              align="center"
              text={String(v)}
              fontFamily={theme.mono}
              fontSize={10}
              fill={theme.muted}
            />
          ))}
          {rulerTicks("y").map((v) => (
            <Text
              key={`ry${v}`}
              x={0}
              y={pan[1] + v * scale - 5}
              width={RULER - 3}
              align="right"
              text={String(v)}
              fontFamily={theme.mono}
              fontSize={10}
              fill={theme.muted}
            />
          ))}
          <Text x={4} y={6} text="m" fontFamily={theme.mono} fontSize={10} fill={theme.muted} />
          <Group x={RULER + 10} y={height - 26}>
            <Rect width={scaleBarM * scale} height={6} stroke={theme.foreground} strokeWidth={1} />
            <Rect width={(scaleBarM * scale) / 2} height={6} fill={theme.foreground} />
            <Text y={9} text="0" fontFamily={theme.mono} fontSize={10} fill={theme.muted} />
            <Text
              x={scaleBarM * scale - 30}
              y={9}
              width={30}
              align="right"
              text={`${scaleBarM} m`}
              fontFamily={theme.mono}
              fontSize={10}
              fill={theme.muted}
            />
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}

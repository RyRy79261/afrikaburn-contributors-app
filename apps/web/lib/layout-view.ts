import { z } from "zod";
import type { LayoutDocument } from "@quagga/types";

// Copy for the read-only camp layout (docs/camp-layout-spec.md §Surfaces;
// frame L3 QZeG7 / t7aOZ3): the member view, the phone view, the print page
// and the camp tile. PURE — no React, no I/O — so the wording has a test.
// Labels are generic ("the camp"); a camp's name is data, shown as data.

const TZ = "Africa/Johannesburg";

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TZ,
  }).format(d);
}

function timeOf(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(d);
}

/** "3 Mar 2027" — a calendar day in South African time. */
export function layoutDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(d);
}

/** "today, 14:32" / "yesterday, 09:05" / "3 Mar 2027, 10:05". */
export function layoutWhen(at: Date, now: Date): string {
  const day = dayKey(at);
  if (day === dayKey(now)) return `today, ${timeOf(at)}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day === dayKey(yesterday)) return `yesterday, ${timeOf(at)}`;
  return `${layoutDayLabel(at)}, ${timeOf(at)}`;
}

/** "last edited today, 14:32, by Alice Hatter" — lower case, for the middle
 * of a line. The name is left out when the account is gone. */
export function lastEditedPhrase(
  at: Date,
  byName: string | null,
  now: Date,
): string {
  return `last edited ${layoutWhen(at, now)}${byName ? `, by ${byName}` : ""}`;
}

/** "Last edited today, 14:32, by Alice Hatter". */
export function lastEditedLine(
  at: Date,
  byName: string | null,
  now: Date,
): string {
  const p = lastEditedPhrase(at, byName, now);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function trim(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** "40 m × 30 m". */
export function plotDimsText(d: { width: number; depth: number }): string {
  return `${trim(d.width)} m × ${trim(d.depth)} m`;
}

/** "13 objects" / "1 object". */
export function objectCountText(n: number): string {
  return `${n} ${n === 1 ? "object" : "objects"}`;
}

/** The camp tile's line: "Plot 40 m × 30 m · 13 objects · last edited
 * today, 14:32, by Alice Hatter". */
export function layoutTileLine(
  summary: { width: number; depth: number; totalObjectCount: number },
  updatedAt: Date,
  updatedByName: string | null,
  now: Date,
): string {
  return [
    `Plot ${plotDimsText(summary)}`,
    objectCountText(summary.totalObjectCount),
    lastEditedPhrase(updatedAt, updatedByName, now),
  ].join(" · ");
}

/** "7 tents inside" / "1 thing inside" — the list row of a shade structure.
 * Tents are counted by name only when everything under it is a tent. */
export function insideText(count: number, tentCount: number): string {
  if (count > 0 && tentCount === count) {
    return `${count} ${count === 1 ? "tent" : "tents"} inside`;
  }
  return `${count} ${count === 1 ? "thing" : "things"} inside`;
}

const AreaParam = z.uuid();

/** `?area=` — a covered area to open. Anything but one uuid is the whole
 * camp; an id that names no covered area is the page's not-found. */
export function parseAreaParam(
  raw: string | string[] | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const parsed = AreaParam.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The layout page, optionally opened on a covered area. */
export function layoutPath(slug: string, areaId?: string | null): string {
  const base = `/camps/${slug}/layout`;
  return areaId ? `${base}?area=${areaId}` : base;
}

/** The printable plan. */
export function layoutPrintPath(slug: string): string {
  return `/camps/${slug}/layout/print`;
}

/** What the camp tile shows, from the layout page's own read. */
export type LayoutTileView =
  | { kind: "no_registration" }
  | { kind: "not_drawn" }
  | {
      kind: "drawn";
      document: LayoutDocument;
      summary: { width: number; depth: number; totalObjectCount: number };
      updatedAt: Date;
      updatedByName: string | null;
    };

export function layoutTileView(view: {
  registration: unknown;
  layout: {
    document: LayoutDocument;
    updatedAt: Date;
    updatedByName: string | null;
  } | null;
  summary: { width: number; depth: number; totalObjectCount: number } | null;
}): LayoutTileView {
  if (!view.registration) return { kind: "no_registration" };
  if (!view.layout || !view.summary) return { kind: "not_drawn" };
  return {
    kind: "drawn",
    document: view.layout.document,
    summary: view.summary,
    updatedAt: view.layout.updatedAt,
    updatedByName: view.layout.updatedByName,
  };
}

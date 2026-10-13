import type { GroupKind, WapRequestStatus } from "@quagga/types";

// Pure copy helpers for the Passes page (epic #53, canvas W1). No React, no
// I/O — so the wording has a test. Labels are generic ("the camp", "the
// project"), never a camp's name: the name is data, shown where it is data.

/** "camp" for a theme camp, "project" for an artwork or a vehicle. */
export function wapProjectNoun(kind: GroupKind): string {
  return kind === "theme_camp" ? "camp" : "project";
}

/** "18 Mar 2027" — a calendar day in South African time. */
export function wapDayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export interface WapRequestLike {
  requested: number;
  reason: string | null;
  status: WapRequestStatus;
  granted: number | null;
  requestedByName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

const passes = (n: number) => `${n} pass${n === 1 ? "" : "es"}`;

/**
 * The heading of one request in the history: the OLDEST is the first request
 * ("First request · 10 passes"), every later one is an ask for more ("Ask for
 * 4 more"). `index` counts from the oldest.
 */
export function wapRequestTitle(r: WapRequestLike, index: number): string {
  return index === 0
    ? `First request · ${passes(r.requested)}`
    : `Ask for ${r.requested} more`;
}

/** "Asked 2 Mar 2027 by Alice · 10 granted on 4 Mar 2027". */
export function wapRequestLine(r: WapRequestLike): string {
  const asked = `Asked ${wapDayLabel(r.createdAt)}${r.requestedByName ? ` by ${r.requestedByName}` : ""}`;
  const decided = r.decidedAt ? ` on ${wapDayLabel(r.decidedAt)}` : "";
  switch (r.status) {
    case "pending":
      return `${asked} · AfrikaBurn hasn't answered yet`;
    case "granted":
      return `${asked} · ${r.granted ?? 0} granted${decided}`;
    case "declined":
      return `${asked} · declined${decided}`;
  }
}

/** "3 passes left to hand out" / "No passes left to hand out". */
export function wapLeftToHandOut(allocated: number, granted: number): string {
  const left = Math.max(0, granted - allocated);
  return left === 0
    ? "No passes left to hand out"
    : `${passes(left)} left to hand out`;
}

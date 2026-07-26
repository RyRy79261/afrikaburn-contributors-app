import { describe, it, expect } from "vitest";
import {
  detectMedicalEnumeration,
  summarizeMedicalAccess,
  MEDICAL_ENUMERATION_SUBJECT_THRESHOLD,
  MEDICAL_ENUMERATION_WINDOW_MS,
  type MedicalReadEvent,
} from "../medical-audit";

const LEAD = "aaaaaaaa-0000-0000-0000-000000000001";
const MEDIC = "aaaaaaaa-0000-0000-0000-000000000002";
const T0 = new Date("2027-04-01T10:00:00.000Z").getTime();

function read(
  actorId: string,
  subjectId: string,
  offsetMs: number,
): MedicalReadEvent {
  return { actorId, subjectId, at: new Date(T0 + offsetMs) };
}

/** A camp lead walking every member of a camp — the documented abuse. */
function rosterWalk(size: number, spacingMs = 3_000): MedicalReadEvent[] {
  return Array.from({ length: size }, (_, i) =>
    read(LEAD, `burner-${i}`, i * spacingMs),
  );
}

describe("REGRESSION: a roster walk is DETECTABLE, not just recorded", () => {
  // The medical read path is deliberately fail-open: no rate limit, no reveal
  // ceremony, and the audit row is written in `after()` so it can never block
  // an emergency read. That makes detection — not prevention — the control, and
  // detection only exists if something derives a signal a human can act on.
  // This is that derivation. If it stops firing, the trail is write-only again.
  it("flags a lead who reads 40 different burners in two minutes", () => {
    const alerts = detectMedicalEnumeration(rosterWalk(40));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.actorId).toBe(LEAD);
    expect(alerts[0]!.subjectCount).toBe(40);
    expect(alerts[0]!.readCount).toBe(40);
    expect(alerts[0]!.windowStart.getTime()).toBe(T0);
    expect(alerts[0]!.windowEnd.getTime()).toBe(T0 + 39 * 3_000);
  });

  it("does NOT flag a medic re-reading the SAME patient many times", () => {
    // Volume is not the signal — distinct subjects are. Flagging an emergency
    // re-check would train staff to ignore the alert, which is worse than none.
    const sameSubject = Array.from({ length: 30 }, (_, i) =>
      read(MEDIC, "burner-in-trouble", i * 10_000),
    );
    expect(detectMedicalEnumeration(sameSubject)).toEqual([]);
  });

  it("does NOT flag legitimate scattered reads under the threshold", () => {
    const scattered = rosterWalk(MEDICAL_ENUMERATION_SUBJECT_THRESHOLD - 1);
    expect(detectMedicalEnumeration(scattered)).toEqual([]);
  });

  it("does NOT flag the same subject count spread beyond the window", () => {
    // One burner per window-plus-a-bit: same total, no burst.
    const spread = Array.from({ length: 20 }, (_, i) =>
      read(LEAD, `burner-${i}`, i * (MEDICAL_ENUMERATION_WINDOW_MS + 60_000)),
    );
    expect(detectMedicalEnumeration(spread)).toEqual([]);
  });

  it("fires exactly at the threshold, not one short of it", () => {
    const atThreshold = rosterWalk(MEDICAL_ENUMERATION_SUBJECT_THRESHOLD);
    expect(detectMedicalEnumeration(atThreshold)).toHaveLength(1);
    expect(
      detectMedicalEnumeration(rosterWalk(MEDICAL_ENUMERATION_SUBJECT_THRESHOLD - 1)),
    ).toHaveLength(0);
  });

  it("attributes bursts per actor and never pools two actors together", () => {
    // Five each: nobody individually enumerates, so nothing fires even though
    // ten distinct burners were read overall.
    const mixed = [
      ...Array.from({ length: 5 }, (_, i) => read(LEAD, `a-${i}`, i * 1_000)),
      ...Array.from({ length: 5 }, (_, i) => read(MEDIC, `b-${i}`, i * 1_000)),
    ];
    expect(detectMedicalEnumeration(mixed)).toEqual([]);
  });

  it("reports the actor's DENSEST window when there are several bursts", () => {
    const small = Array.from({ length: 9 }, (_, i) => read(LEAD, `s-${i}`, i * 1_000));
    const big = Array.from({ length: 25 }, (_, i) =>
      read(LEAD, `b-${i}`, 5 * MEDICAL_ENUMERATION_WINDOW_MS + i * 1_000),
    );
    const alerts = detectMedicalEnumeration([...small, ...big]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.subjectCount).toBe(25);
  });

  it("sorts alerts worst-first (most burners exposed)", () => {
    const events = [
      ...Array.from({ length: 10 }, (_, i) => read(MEDIC, `m-${i}`, i * 1_000)),
      ...Array.from({ length: 30 }, (_, i) => read(LEAD, `l-${i}`, i * 1_000)),
    ];
    const alerts = detectMedicalEnumeration(events);
    expect(alerts.map((a) => a.actorId)).toEqual([LEAD, MEDIC]);
  });

  it("ignores rows with no actor or no subject and unparseable dates", () => {
    // `actor_id` is ON DELETE SET NULL, so sanitized accounts leave null actors.
    const junk: MedicalReadEvent[] = [
      { actorId: null, subjectId: "x", at: new Date(T0) },
      { actorId: LEAD, subjectId: null, at: new Date(T0) },
      { actorId: LEAD, subjectId: "y", at: new Date(Number.NaN) },
    ];
    expect(detectMedicalEnumeration(junk)).toEqual([]);
    expect(summarizeMedicalAccess(junk).reads).toBe(0);
  });

  it("handles an empty trail without inventing an alert", () => {
    expect(detectMedicalEnumeration([])).toEqual([]);
  });
});

describe("summarizeMedicalAccess — the numbers the console shows", () => {
  it("counts reads, distinct actors, distinct subjects and the newest read", () => {
    const events = [
      read(LEAD, "burner-1", 0),
      read(LEAD, "burner-1", 1_000),
      read(LEAD, "burner-2", 2_000),
      read(MEDIC, "burner-2", 3_000),
    ];
    const summary = summarizeMedicalAccess(events);
    expect(summary.reads).toBe(4);
    expect(summary.actors).toBe(2);
    expect(summary.subjects).toBe(2);
    expect(summary.lastReadAt?.getTime()).toBe(T0 + 3_000);
    expect(summary.alerts).toEqual([]);
  });

  it("is empty and alert-free for an empty trail", () => {
    const summary = summarizeMedicalAccess([]);
    expect(summary).toEqual({
      reads: 0,
      actors: 0,
      subjects: 0,
      lastReadAt: null,
      alerts: [],
    });
  });

  it("carries the enumeration alerts through", () => {
    const summary = summarizeMedicalAccess(rosterWalk(40));
    expect(summary.alerts).toHaveLength(1);
    expect(summary.subjects).toBe(40);
  });

  it("honours caller-supplied window and threshold overrides", () => {
    const events = rosterWalk(4, 1_000);
    expect(detectMedicalEnumeration(events, { subjectThreshold: 4 })).toHaveLength(1);
    // A window shorter than the spacing can never hold more than one read.
    expect(
      detectMedicalEnumeration(events, { subjectThreshold: 2, windowMs: 500 }),
    ).toHaveLength(0);
  });
});

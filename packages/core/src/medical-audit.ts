// The READ side of the medical audit trail — the compensating control for a
// deliberately FAIL-OPEN disclosure path.
//
// `medical-access.ts` answers "may this actor see these notes?". The read
// itself is never blocked, never rate-limited and never delayed by its own
// audit row (AGENTS.md: an emergency read must not wait on a log write, so the
// insert runs in `after()` and a failed insert is logged, not surfaced). That
// choice is right, and it means PREVENTION is not the control here — DETECTION
// is. A write-only audit table detects nothing: rows nobody ever reads are not
// a control, they are a filing cabinet.
//
// So this module is the other half: pure derivations over `bio.medical.view`
// rows that turn them into something a human can act on.
//
//   - `summarizeMedicalAccess` — how many disclosing reads, by how many actors,
//     of how many burners, and when the last one was.
//   - `detectMedicalEnumeration` — the abuse shape the trail exists to catch:
//     ONE actor reading MANY DIFFERENT burners' notes in a short window (a camp
//     lead walking every member of their 40-person camp). A medic re-opening
//     the SAME patient ten times in an emergency is not enumeration and must
//     never be flagged — the signal is DISTINCT SUBJECTS per window, never
//     read volume.
//
// Pure and I/O-free like the rest of @quagga/core: the apps load the rows and
// render the result (org console `/audit`).

/** One `audit_events` row with `action = bio.medical.view`, narrowed to the
 * three facts detection needs. Rows missing an actor or a subject (a sanitized
 * account nulls `actor_id`) carry no signal and are ignored. */
export interface MedicalReadEvent {
  actorId: string | null;
  subjectId: string | null;
  at: Date;
}

/**
 * The window enumeration is measured over. One hour: long enough that a walk
 * down a roster stays inside it even at a browsing pace, short enough that a
 * safety team legitimately working a busy incident day does not accumulate a
 * false positive across unrelated hours.
 */
export const MEDICAL_ENUMERATION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Distinct burners one actor may read inside the window before it is called
 * enumeration. Eight is above any plausible single incident (a medic handling
 * one casualty, a lead checking the two people on a shift) and far below a
 * camp roster walk, which is the documented abuse.
 */
export const MEDICAL_ENUMERATION_SUBJECT_THRESHOLD = 8;

export interface MedicalEnumerationOptions {
  /** Sliding window in ms (default `MEDICAL_ENUMERATION_WINDOW_MS`). */
  windowMs?: number;
  /** Distinct subjects in-window that trip the flag (default 8). */
  subjectThreshold?: number;
}

/** One actor's densest burst of medical reads, when it crosses the threshold. */
export interface MedicalEnumerationAlert {
  actorId: string;
  /** DISTINCT burners whose notes this actor read inside the window. */
  subjectCount: number;
  /** Reads inside that same window (>= `subjectCount`). */
  readCount: number;
  windowStart: Date;
  windowEnd: Date;
}

interface ValidRead {
  actorId: string;
  subjectId: string;
  time: number;
  at: Date;
}

/** Drop rows that carry no signal: no actor, no subject, or an unusable date. */
function validReads(events: readonly MedicalReadEvent[]): ValidRead[] {
  const out: ValidRead[] = [];
  for (const event of events) {
    if (!event.actorId || !event.subjectId) continue;
    const time = event.at instanceof Date ? event.at.getTime() : Number.NaN;
    if (Number.isNaN(time)) continue;
    out.push({
      actorId: event.actorId,
      subjectId: event.subjectId,
      time,
      at: event.at,
    });
  }
  return out;
}

function groupByActor(reads: readonly ValidRead[]): Map<string, ValidRead[]> {
  const byActor = new Map<string, ValidRead[]>();
  for (const read of reads) {
    const existing = byActor.get(read.actorId);
    if (existing) existing.push(read);
    else byActor.set(read.actorId, [read]);
  }
  return byActor;
}

/**
 * Flag every actor who read the medical notes of `subjectThreshold` or more
 * DISTINCT burners inside any `windowMs` window.
 *
 * Sliding window with a subject multiset, so cost is linear per actor and the
 * reported window is the actor's densest one (the strongest evidence), not the
 * first one found. Repeat reads of the same burner inflate `readCount` but
 * never `subjectCount` — treating a medic's repeated check of one patient as
 * abuse would train staff to ignore the alert.
 */
export function detectMedicalEnumeration(
  events: readonly MedicalReadEvent[],
  options: MedicalEnumerationOptions = {},
): MedicalEnumerationAlert[] {
  const windowMs = Math.max(0, options.windowMs ?? MEDICAL_ENUMERATION_WINDOW_MS);
  const subjectThreshold = Math.max(
    1,
    options.subjectThreshold ?? MEDICAL_ENUMERATION_SUBJECT_THRESHOLD,
  );

  const alerts: MedicalEnumerationAlert[] = [];

  for (const [actorId, actorReads] of groupByActor(validReads(events))) {
    const sorted = [...actorReads].sort((a, b) => a.time - b.time);
    const counts = new Map<string, number>();
    let left = 0;
    let best: MedicalEnumerationAlert | null = null;

    for (let right = 0; right < sorted.length; right += 1) {
      const entering = sorted[right]!;
      counts.set(entering.subjectId, (counts.get(entering.subjectId) ?? 0) + 1);

      // Shrink from the left until the window holds again. `left <= right`
      // always, and a zero-width span is never > windowMs, so this terminates.
      while (entering.time - sorted[left]!.time > windowMs) {
        const leaving = sorted[left]!;
        const remaining = (counts.get(leaving.subjectId) ?? 0) - 1;
        if (remaining <= 0) counts.delete(leaving.subjectId);
        else counts.set(leaving.subjectId, remaining);
        left += 1;
      }

      const subjectCount = counts.size;
      if (best === null || subjectCount > best.subjectCount) {
        best = {
          actorId,
          subjectCount,
          readCount: right - left + 1,
          windowStart: sorted[left]!.at,
          windowEnd: entering.at,
        };
      }
    }

    if (best !== null && best.subjectCount >= subjectThreshold) {
      alerts.push(best);
    }
  }

  // Worst first: most burners exposed, then most recent.
  return alerts.sort(
    (a, b) =>
      b.subjectCount - a.subjectCount ||
      b.windowEnd.getTime() - a.windowEnd.getTime(),
  );
}

export interface MedicalAccessSummary {
  /** Disclosing reads in the supplied set. */
  reads: number;
  /** Distinct actors who performed them. */
  actors: number;
  /** Distinct burners whose notes were disclosed. */
  subjects: number;
  /** Newest read in the set, or null when there are none. */
  lastReadAt: Date | null;
  /** Actors whose reads look like enumeration (worst first). */
  alerts: MedicalEnumerationAlert[];
}

/**
 * Roll a set of `bio.medical.view` rows up into the numbers the console shows,
 * plus the enumeration alerts. Self-reads are never audited in the first place,
 * so everything here is a disclosure of someone ELSE's notes.
 */
export function summarizeMedicalAccess(
  events: readonly MedicalReadEvent[],
  options: MedicalEnumerationOptions = {},
): MedicalAccessSummary {
  const reads = validReads(events);
  const actors = new Set<string>();
  const subjects = new Set<string>();
  let lastReadAt: Date | null = null;

  for (const read of reads) {
    actors.add(read.actorId);
    subjects.add(read.subjectId);
    if (lastReadAt === null || read.time > lastReadAt.getTime()) {
      lastReadAt = read.at;
    }
  }

  return {
    reads: reads.length,
    actors: actors.size,
    subjects: subjects.size,
    lastReadAt,
    alerts: detectMedicalEnumeration(events, options),
  };
}

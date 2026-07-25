// Pure presentation logic for the status board / overview: audit-action
// labels, the activity dot tone, relative timestamps and the month bucketing
// behind "registrations over time". No I/O and no `server-only`, so every
// derivation here is unit-testable (lib/__tests__/status-board-format.test.ts).
// The DB reads that feed these live in lib/status-board.ts.

/** Human label for an audit action. Unknown actions fall back to the key. */
const ACTIVITY_LABELS: Record<string, string> = {
  "registration.start_review": "started reviewing a registration",
  "registration.approve": "approved a registration",
  "registration.request_changes": "requested changes on a registration",
  "registration.reject": "rejected a registration",
  "review.comment": "commented on a registration section",
  "account.elevate": "changed an account role",
  "supplier.add": "added a supplier",
  "supplier.standing": "changed a supplier's standing",
  "supplier.onboarding": "updated supplier onboarding",
  "supplier.note": "added a supplier note",
  "supplier_document.create": "added a supplier document",
  "supplier_document.update": "updated a supplier document",
  "supplier_document.delete": "removed a supplier document",
  "questionnaire.definition.create": "created a questionnaire",
  "questionnaire.definition.update": "edited a questionnaire",
  "questionnaire.activate": "released a questionnaire",
  "questionnaire.close": "closed a questionnaire",
  "bulletin.publish": "published a bulletin",
  "bulletin.pin": "pinned a bulletin",
  "category.create": "added a camp category",
  "category.update": "edited a camp category",
  "category.delete": "removed a camp category",
  "category.assign": "changed a camp's categories",
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}

export type ActivityTone = "approve" | "attention" | "reject" | "neutral";

/** Coarse tone for the activity dot — decisions read differently to admin. */
export function activityTone(action: string): ActivityTone {
  if (action === "registration.approve") return "approve";
  if (action === "registration.reject") return "reject";
  if (
    action === "registration.request_changes" ||
    action === "registration.start_review"
  ) {
    return "attention";
  }
  return "neutral";
}

/** Compact relative time ("12 min ago", "3 h ago", "2 d ago"). */
export function relativeTime(value: Date, now: Date = new Date()): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - value.getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}

export interface SeriesPoint {
  /** `YYYY-MM` — stable key for the bucket. */
  key: string;
  /** Short month label, e.g. "Sep". */
  label: string;
  /** Registrations submitted in this month. */
  count: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Bucket submission timestamps into consecutive calendar months, gaps filled
 * with zeroes so the x-axis is continuous. Returns [] for no input — the caller
 * omits the chart rather than drawing an empty plot.
 */
export function bucketSubmissionsByMonth(
  dates: readonly Date[],
): SeriesPoint[] {
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return [];

  const counts = new Map<string, number>();
  for (const d of valid) {
    const key = monthKey(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...valid].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const points: SeriesPoint[] = [];
  const cursor = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
  );
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1);
  // Guard against a runaway loop on absurd data (10 years of months).
  for (let i = 0; i < 120 && cursor.getTime() <= end; i += 1) {
    const key = monthKey(cursor);
    points.push({
      key,
      label: MONTHS[cursor.getUTCMonth()]!,
      count: counts.get(key) ?? 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

/** True when there is enough history for a time series to mean anything. */
export function hasSeries(points: readonly SeriesPoint[]): boolean {
  return points.length >= 2;
}

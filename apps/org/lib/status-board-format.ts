// Pure presentation logic for the status board / overview: audit-action
// labels, the activity dot tone, relative timestamps and the month bucketing
// behind "registrations over time". No I/O and no `server-only`, so every
// derivation here is unit-testable (lib/__tests__/status-board-format.test.ts).
// The DB reads that feed these live in lib/status-board.ts.

import { MEDICAL_VIEW_AUDIT_ACTION } from "@quagga/core";

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
  // THE PERMISSION MODEL ITSELF. These are the changes that decide what everyone
  // else can read and destroy, so they must read as English in the trail rather
  // than as a dotted key — the audit log is the only thing keeping the System
  // manager rank honest, and a row nobody can read is not a control.
  "org.department.create": "created an org department",
  "org.department.rename": "renamed an org department",
  "org.department.delete": "deleted an org department and its roles",
  "org.department.domains": "changed what a department owns",
  "org.role.create": "created an org role",
  "org.role.update": "changed what an org role may do",
  "org.role.delete": "deleted an org role",
  "org.roles.assign": "changed which org roles someone holds",
  [MEDICAL_VIEW_AUDIT_ACTION]: "read a burner's medical notes",
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
    action === "registration.start_review" ||
    action === MEDICAL_VIEW_AUDIT_ACTION
  ) {
    return "attention";
  }
  return "neutral";
}

/**
 * Audit actions kept OUT of the six-row "Recent activity" card.
 *
 * Only medical reads, and not because they are unimportant — the opposite. A
 * `bio.medical.view` row is written on every disclosing read, so one camp lead
 * walking a roster emits dozens in a minute and would push every registration
 * decision off a six-row feed. They get a surface that can actually hold them
 * (`/audit`, with the enumeration alerts), instead of drowning the one that
 * cannot. `activityLabel` still names them there.
 */
export const FEED_EXCLUDED_ACTIONS: readonly string[] = [
  MEDICAL_VIEW_AUDIT_ACTION,
];

/** True when an audit action belongs in the short overview activity feed. */
export function isFeedAction(action: string): boolean {
  return !FEED_EXCLUDED_ACTIONS.includes(action);
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

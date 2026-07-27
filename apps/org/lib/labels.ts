// Presentation labels local to the console. Section labels live in
// @quagga/types (SECTION_LABELS); these cover group kinds and other display
// text the console needs.

export const GROUP_KIND_LABELS: Record<string, string> = {
  org: "Organisation",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

export const JOINABILITY_LABELS: Record<string, string> = {
  open: "Accepting members",
  invite_only: "Invite only",
};

/** Format a cents amount + currency, or a dash when no amount is recorded. */
export function formatMoney(
  amountCents: number | null,
  currency: string,
): string {
  if (amountCents == null) return "—";
  const major = (amountCents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}

/** Short, locale-stable date (e.g. "26 Apr 2027"). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Date + time to the minute (e.g. "26 Apr 2027, 14:03") — the audit trail
 * needs the clock, not just the day: a burst is only visible with minutes. */
export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

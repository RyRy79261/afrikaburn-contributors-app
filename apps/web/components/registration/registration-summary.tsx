import * as React from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileClock,
  Hourglass,
  MessageSquare,
  MessageSquareWarning,
  XCircle,
} from "lucide-react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type RegistrationStatus,
  type SectionKey,
} from "@quagga/types";
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { ReopenRegistrationButton } from "./reopen-registration-button";
import type { TransitionResult } from "@/lib/registration-store";
import type {
  CampSectionReview,
  RegistrationRow,
} from "@/lib/registration-store";
import { SectionReplyThread } from "./section-reply-thread";

// Read-only post-submission view (build-spec §apps/web): status banner +
// read-only sections + per-section AB feedback threads. The resubmit loop lives
// in the editable wizard (changes_requested reopens it), so this covers the
// locked states: submitted, under_review, approved, rejected, withdrawn.

const HOURS_LABEL: Record<string, string> = {
  morning: "Morning",
  day: "Day",
  night: "Night",
  late_night: "Late night",
};

const STATUS_BANNER: Record<
  RegistrationStatus,
  { title: string; body: string; icon: React.ReactNode; tone: string }
> = {
  draft: {
    title: "Draft",
    body: "This registration hasn't been submitted yet.",
    icon: <FileClock className="h-5 w-5" aria-hidden />,
    tone: "border-border bg-secondary/40 text-foreground",
  },
  submitted: {
    title: "Submitted — awaiting review",
    body: "AfrikaBurn has your registration. You'll hear back once a reviewer picks it up.",
    icon: <Hourglass className="h-5 w-5 text-accent" aria-hidden />,
    tone: "border-accent/40 bg-accent/10 text-foreground",
  },
  under_review: {
    title: "Under review",
    body: "An AfrikaBurn reviewer is going through your registration section by section.",
    icon: <Clock className="h-5 w-5 text-accent" aria-hidden />,
    tone: "border-accent/40 bg-accent/10 text-foreground",
  },
  changes_requested: {
    title: "Changes requested",
    body: "AfrikaBurn asked for changes. Reopen the wizard to update and resubmit.",
    icon: <MessageSquare className="h-5 w-5 text-warning" aria-hidden />,
    tone: "border-warning/40 bg-warning/10 text-foreground",
  },
  approved: {
    title: "Approved — you're registered",
    body: "Your camp is confirmed for this edition. Entitlements are unlocked on your dashboard.",
    icon: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />,
    tone: "border-success/40 bg-success/10 text-foreground",
  },
  rejected: {
    title: "Not approved",
    body: "This registration wasn't approved. See the reviewer's notes below.",
    icon: <XCircle className="h-5 w-5 text-destructive" aria-hidden />,
    tone: "border-destructive/40 bg-destructive/10 text-foreground",
  },
  withdrawn: {
    title: "Withdrawn",
    body: "You withdrew this registration. Your camp still exists as a free camp.",
    icon: <XCircle className="h-5 w-5 text-muted-foreground" aria-hidden />,
    tone: "border-border bg-secondary/40 text-foreground",
  },
};

function yesNo(v: boolean | null): string {
  if (v === null) return "—";
  return v ? "Yes" : "No";
}

function text(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v : "—";
}

/** Relative "N days ago" for the feedback thread timestamps. */
function formatRelative(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** Per-section review state → row status pill + icon (canvas P0Tcl section rows). */
function sectionStatus(reviews: CampSectionReview[]): {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
  icon: React.ReactNode;
} {
  if (reviews.some((r) => r.status === "open")) {
    return {
      label: "Changes requested",
      variant: "warning",
      icon: (
        <MessageSquareWarning
          className="h-5 w-5 shrink-0 text-warning"
          aria-hidden
        />
      ),
    };
  }
  if (reviews.length > 0) {
    return {
      label: "Reviewed",
      variant: "success",
      icon: (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
      ),
    };
  }
  return {
    label: "Complete",
    variant: "success",
    icon: (
      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
    ),
  };
}

interface Field {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}

export function RegistrationSummary({
  registration,
  campName,
  description,
  supplierNames,
  reviews,
  slug,
  viewerUserId,
  reopenAction,
}: {
  registration: RegistrationRow;
  campName: string;
  description: string | null;
  supplierNames: string[];
  reviews: CampSectionReview[];
  /** Camp slug — for the reply action (never trusted for authz server-side). */
  slug: string;
  /** The viewer's db user id — labels their own replies "You". */
  viewerUserId: string | null;
  /** Present only for a camp admin on a WITHDRAWN registration — the way back. */
  reopenAction?: (slug: string) => Promise<TransitionResult>;
}) {
  const r = registration;
  const banner = STATUS_BANNER[r.status];
  const reviewsBySection = new Map<string, CampSectionReview[]>();
  for (const rev of reviews) {
    const list = reviewsBySection.get(rev.sectionKey) ?? [];
    list.push(rev);
    reviewsBySection.set(rev.sectionKey, list);
  }

  const layout =
    r.s4LayoutUploadUrls.length > 0 ? (
      <span className="flex flex-col gap-1">
        {r.s4LayoutUploadUrls.map((url, i) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Layout {i + 1}
          </a>
        ))}
      </span>
    ) : (
      "—"
    );

  const suppliers = supplierNames.length > 0 ? supplierNames.join(", ") : "—";

  const fieldsBySection: Record<SectionKey, Field[]> = {
    identity: [
      { label: "Camp name", value: campName },
      { label: "Description", value: text(description), wide: true },
      { label: "Contact email", value: text(r.s1ContactEmail) },
      { label: "Alt contact", value: text(r.s1AltContactName) },
      { label: "Alt contact phone", value: text(r.s1AltContactPhone) },
      { label: "Alt contact email", value: text(r.s1AltContactEmail) },
    ],
    lnt: [
      { label: "LNT plan", value: text(r.s2LntPlan), wide: true },
      { label: "LNT lead", value: text(r.s2LntLeadName) },
      { label: "LNT lead phone", value: text(r.s2LntLeadPhone) },
      { label: "LNT lead email", value: text(r.s2LntLeadEmail) },
    ],
    participation: [
      {
        label: "Participation plan",
        value: text(r.s3ParticipationPlan),
        wide: true,
      },
      {
        label: "Operating hours",
        value:
          r.s3OperatingHours.length > 0
            ? r.s3OperatingHours.map((h) => HOURS_LABEL[h] ?? h).join(", ")
            : "—",
      },
      { label: "Gifting food?", value: yesNo(r.s3GiftingFood) },
      { label: "Schedule detail", value: text(r.s3ScheduleDetail), wide: true },
    ],
    size_logistics: [
      { label: "Expected population", value: r.s4ExpectedPopulation ?? "—" },
      { label: "First arrival", value: text(r.s4FirstArrivalDate) },
      { label: "Work access passes", value: r.s4WorkAccessPasses ?? "—" },
      { label: "Area dimensions", value: text(r.s4AreaDimensions) },
      { label: "Layout uploads", value: layout, wide: true },
    ],
    sound_placement: [
      { label: "Amplified music", value: text(r.s5AmplifiedMusic) },
      { label: "Sound plan", value: text(r.s5SoundPlan), wide: true },
      {
        label: "Placement — 1st choice",
        value: text(r.s5PlacementFirstChoice),
      },
      {
        label: "Placement — 2nd choice",
        value: text(r.s5PlacementSecondChoice),
      },
      { label: "Neighbour request", value: text(r.s5NeighbourRequest) },
      { label: "Family-friendly?", value: text(r.s5FamilyFriendly) },
    ],
    suppliers_commerce: [
      { label: "Declared suppliers", value: suppliers, wide: true },
      { label: "Suppliers note", value: text(r.s6SuppliersNote), wide: true },
      { label: "Paid performers?", value: yesNo(r.s6PaidPerformers) },
      {
        label: "Expected budget",
        value:
          r.s6ExpectedBudgetZar != null
            ? `ZAR ${r.s6ExpectedBudgetZar.toLocaleString("en-ZA")}`
            : "—",
      },
      { label: "Fee structure", value: text(r.s6FeeStructure), wide: true },
      { label: "Plug & Play acknowledged", value: yesNo(r.s6PlugAndPlayAck) },
    ],
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Status banner (canvas P0Tcl `Ovnjk`) */}
      <div
        className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 ${banner.tone}`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0">{banner.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{banner.title}</p>
            <p className="mt-0.5 text-sm opacity-80">{banner.body}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusBadge status={r.status} />
          {/* Withdrawn is the camp's own decision and is reversible; the
              dialog that caused it says so. Rejected is AfrikaBurn's and is
              not, so no control appears there. */}
          {r.status === "withdrawn" && reopenAction ? (
            <ReopenRegistrationButton slug={slug} reopenAction={reopenAction} />
          ) : null}
        </div>
      </div>

      {/* Per-section review states + feedback threads (canvas `HmdmU`). Each
          section collapses to a status row; open feedback shows an AfrikaBurn
          comment thread, and the submitted answers stay one click away. */}
      <div className="flex flex-col gap-3">
        {SECTION_KEYS.map((key) => {
          const secReviews = reviewsBySection.get(key) ?? [];
          const st = sectionStatus(secReviews);
          return (
            <div key={key} className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  {st.icon}
                  <span className="truncate text-sm font-medium text-foreground">
                    {SECTION_LABELS[key]}
                  </span>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>

              {secReviews.length > 0 && (
                <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                  {secReviews.map((rev) => (
                    <div key={rev.id} className="flex gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                        aria-hidden
                      >
                        AB
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-sm font-medium text-foreground">
                            AfrikaBurn
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(rev.createdAt)} ·{" "}
                            {rev.status === "open" ? "Open" : "Resolved"}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {rev.comment}
                        </p>
                        <SectionReplyThread
                          slug={slug}
                          reviewId={rev.id}
                          replies={rev.replies}
                          viewerUserId={viewerUserId}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <details className="border-t border-border">
                <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                  View what you submitted
                </summary>
                <div className="px-4 pb-4">
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {fieldsBySection[key].map((f) => (
                      <div
                        key={f.label}
                        className={f.wide ? "sm:col-span-2" : undefined}
                      >
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {f.label}
                        </dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

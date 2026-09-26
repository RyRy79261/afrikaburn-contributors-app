import * as React from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
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
} from "@quagga/types";
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { ReopenRegistrationButton } from "./reopen-registration-button";
import type {
  CampSectionReview,
  DeclaredSupplier,
  RegistrationRow,
  TransitionResult,
} from "@/lib/registration-store";
import {
  RegistrationAnswerList,
  registrationFieldsBySection,
} from "./registration-answers";
import { SectionReplyThread } from "./section-reply-thread";
import { WithdrawRegistrationButton } from "./withdraw-registration";

// Read-only post-submission view (build-spec §apps/web): status banner +
// read-only sections + per-section AB feedback threads. The resubmit loop lives
// in the editable wizard (changes_requested reopens it), so this covers the
// locked states: submitted, under_review, approved, rejected, withdrawn.

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
    body: "This registration wasn't approved. The reviewer's reason is below, with any section notes under it.",
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

/**
 * Per-section review state → row status pill + icon (canvas P0Tcl section rows).
 *
 * `complete` is the SERVER's verdict — `registrations.completed_sections`, which
 * `saveRegistrationDraft` recomputes from the core predicates on every save and
 * never takes from the client. Without it this fell through to a green
 * "Complete" for any section that simply had no review attached, so a
 * registration withdrawn or rejected while half-empty presented six green ticks
 * and "Complete" against sections the camp had never filled in.
 */
function sectionStatus(
  reviews: CampSectionReview[],
  complete: boolean,
): {
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
  if (!complete) {
    return {
      label: "Incomplete",
      variant: "outline",
      icon: (
        <Circle
          className="h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
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

export function RegistrationSummary({
  registration,
  campName,
  description,
  declaredSuppliers,
  reviews,
  slug,
  editionYear,
  viewerUserId,
  reopenAction,
  withdrawAction,
}: {
  registration: RegistrationRow;
  campName: string;
  description: string | null;
  /** Every supplier the camp declared, suspended ones included (see below). */
  declaredSuppliers: DeclaredSupplier[];
  reviews: CampSectionReview[];
  /** Camp slug — for the reply action (never trusted for authz server-side). */
  slug: string;
  editionYear: number;
  /** The viewer's db user id — labels their own replies "You". */
  viewerUserId: string | null;
  /** Present only for a camp admin on a WITHDRAWN registration — the way back. */
  reopenAction?: (slug: string) => Promise<TransitionResult>;
  withdrawAction: (slug: string) => Promise<TransitionResult>;
}) {
  const r = registration;
  const banner = STATUS_BANNER[r.status];
  const completedSections = new Set(r.completedSections);
  const reviewsBySection = new Map<string, CampSectionReview[]>();
  for (const rev of reviews) {
    const list = reviewsBySection.get(rev.sectionKey) ?? [];
    list.push(rev);
    reviewsBySection.set(rev.sectionKey, list);
  }

  const fieldsBySection = registrationFieldsBySection({
    registration: r,
    campName,
    description,
    declaredSuppliers,
  });

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
            {/* THE REASON, IN THE REVIEWER'S OWN WORDS (migration 0025).
                Rejecting and asking for changes both REQUIRE one, and it used
                to reach only `audit_events.meta` and the decision
                notification — while this banner said "See the reviewer's notes
                below" and pointed at the per-section thread, which a reviewer
                who simply rejected never wrote to. A camp could read its own
                registration and find no explanation anywhere on the page. */}
            {/* ONLY WHERE IT IS STILL TRUE. `decision_reason` is the reviewer's
                words for the CURRENT state, and of the locked states only
                `rejected` carries any. Rendering it unconditionally put an old
                change-request under a green "Approved" banner and under
                "Withdrawn" — sentences AfrikaBurn was no longer saying,
                presented as if they were. Migration 0027 cleared the rows
                0025's backfill wrote; this stops the screen re-creating the
                same lie from any future stray value. */}
            {r.decisionReason && r.status === "rejected" ? (
              <p className="mt-2 whitespace-pre-line rounded-lg border border-current/20 bg-background/40 p-3 text-sm">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide opacity-70">
                  From the reviewer
                </span>
                {r.decisionReason}
              </p>
            ) : null}
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
          const st = sectionStatus(secReviews, completedSections.has(key));
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
                  <RegistrationAnswerList fields={fieldsBySection[key]} />
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <WithdrawRegistrationButton
        slug={slug}
        status={r.status}
        editionYear={editionYear}
        withdrawAction={withdrawAction}
      />
    </div>
  );
}

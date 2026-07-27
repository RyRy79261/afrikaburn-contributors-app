import Link from "next/link";
import { ChevronRight, Lock, UserPlus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import type { SectionKey } from "@quagga/types";

import type {
  DecisionLogRow,
  OfficerContactRow,
  RegistrationDetail,
  RosterMemberRow,
} from "@/lib/queries";
import type { OfficersCopy } from "@/lib/project-review";
import { formatDate } from "@/lib/labels";
import { FieldList, type FieldSpec } from "@/components/field-list";
import { DecisionPanel } from "@/components/decision-panel";
import { SectionReviewThread } from "@/components/section-review-thread";
import { MemberRoster } from "@/components/member-roster";

/** One review section as the shell renders it (fields already resolved to JSX). */
export interface ReviewSectionView {
  key: SectionKey;
  label: string;
  fields: FieldSpec[];
}

/**
 * The shared registration-review shell: breadcrumb, header, section cards with
 * per-section review threads, officers, and the action rail (decision + audit +
 * history). Kind-agnostic — the caller supplies the section list, header meta,
 * and honest per-kind copy. Camp and MV/art paths both render through here so
 * the review ACTIONS, TOCTOU guard, and audit trail behave identically.
 */
export function RegistrationReview({
  detail,
  decisionLog,
  officers,
  sections,
  meta,
  subjectNoun,
  officersCopy,
  showWrangler,
  roster,
}: {
  detail: RegistrationDetail;
  decisionLog: DecisionLogRow[];
  officers: OfficerContactRow[];
  sections: ReviewSectionView[];
  meta: string[];
  subjectNoun: string;
  officersCopy: OfficersCopy;
  showWrangler: boolean;
  roster: RosterMemberRow[];
}) {
  const { registration, group, edition } = detail;

  // Reviews grouped by the section keys actually on display.
  const shownKeys = new Set(sections.map((s) => s.key));
  const reviewsBySection = new Map<SectionKey, RegistrationDetail["reviews"]>();
  for (const s of sections) reviewsBySection.set(s.key, []);
  for (const r of detail.reviews) {
    if (shownKeys.has(r.sectionKey as SectionKey)) {
      reviewsBySection.get(r.sectionKey as SectionKey)!.push(r);
    }
  }
  const openThreadTotal = [...reviewsBySection.values()].reduce(
    (total, list) => total + list.filter((r) => r.status === "open").length,
    0,
  );

  const decisionDescription =
    openThreadTotal > 0
      ? `Resolve the ${
          openThreadTotal === 1
            ? "open thread"
            : `${openThreadTotal} open threads`
        } before approving. Approving marks this ${subjectNoun} registered for ${edition.name}.`
      : subjectNoun === "camp"
        ? `Approving marks this camp registered for ${edition.name} and unlocks its entitlements. Transitions are validated against the registration state machine.`
        : `Approving marks this ${subjectNoun} registered for ${edition.name}. Transitions are validated against the registration state machine.`;

  return (
    <div>
      {/* Breadcrumb — Console > Registrations > project */}
      <nav
        aria-label="Breadcrumb"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/" className="hover:text-foreground">
          Console
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <Link href="/registrations" className="hover:text-foreground">
          Registrations
        </Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
        <span className="text-foreground">{group.name}</span>
      </nav>

      {/* Header — LEFT-aligned (status pill inline with the title). */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <StatusBadge status={registration.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {meta.map((m, i) => (
            <span key={m} className="flex items-center gap-x-2">
              {i > 0 && <span aria-hidden>·</span>}
              {m}
            </span>
          ))}
        </div>
        {registration.decidedAt && (
          <p className="mt-1 text-sm text-muted-foreground">
            Decided {formatDate(registration.decidedAt)}
            {detail.decidedByEmail ? ` by ${detail.decidedByEmail}` : ""}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Sections column */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {sections.map((section) => {
            const reviews = reviewsBySection.get(section.key) ?? [];
            const openCount = reviews.filter((r) => r.status === "open").length;
            return (
              <Card key={section.key} id={section.key}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">{section.label}</CardTitle>
                  {openCount > 0 ? (
                    <Badge variant="warning">
                      {openCount} OPEN THREAD{openCount > 1 ? "S" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">REVIEWED</Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <FieldList fields={section.fields} />
                  <SectionReviewThread
                    registrationId={registration.id}
                    sectionKey={section.key}
                    comments={reviews}
                  />
                </CardContent>
              </Card>
            );
          })}

          {/* Officers — accepted officer registrations share contact with org. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{officersCopy.title}</CardTitle>
              <CardDescription>{officersCopy.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {officers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {officersCopy.empty}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {officers.map((o) => (
                    <li
                      key={`${o.officerKey}-${o.email ?? o.displayName ?? "x"}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                    >
                      <span className="font-medium">
                        {o.emoji ? `${o.emoji} ` : ""}
                        {o.officerName}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                        <span>{o.displayName ?? "—"}</span>
                        {o.email && <span>{o.email}</span>}
                        {o.phone && (
                          <span className="tabular-nums">{o.phone}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Members. NOTHING medical is listed here — not the notes, and not a
              has/has-not signpost either: whether a named person has declared a
              condition is itself special personal information, and a column of
              it is an un-audited census. Open a member to see theirs on their
              detail page, where the read is authorized AND recorded (privacy
              law: medical is never public, never in a list, roster, card or
              export, and visible only to the burner's camp leads + org staff). */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" aria-hidden />
                Members
              </CardTitle>
              <CardDescription>
                Open a member to see their medical notes. Nothing medical — not
                even whether notes exist — appears in this list or any export,
                and every view on a member&apos;s page is logged.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MemberRoster registrationId={registration.id} members={roster} />
            </CardContent>
          </Card>
        </div>

        {/* Action rail */}
        <aside className="flex w-full shrink-0 flex-col gap-6 lg:sticky lg:top-6 lg:w-[360px]">
          {/* Decision */}
          <Card className="border-accent/40">
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
              <CardDescription>{decisionDescription}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <DecisionPanel
                registrationId={registration.id}
                status={registration.status}
                subjectNoun={subjectNoun}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Every decision is logged to the audit trail.
              </p>
            </CardContent>
          </Card>

          {/* Assign a wrangler — camp-only (theme-camp leads team owns it). */}
          {showWrangler && (
            <Card>
              <CardHeader>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  After approval
                </p>
                <CardTitle className="text-base">Assign a wrangler</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  A wrangler shepherds the camp through build week and check-in.
                  You can assign one once this registration is approved.
                </p>
                <Button variant="outline" disabled className="w-full">
                  <UserPlus aria-hidden />
                  Assign wrangler
                </Button>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Unlocks after approval — handled by the theme-camp leads team.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Decision history */}
          {decisionLog.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Decision history</CardTitle>
                <CardDescription>
                  Audit trail of reviewer actions on this registration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {decisionLog.map((e) => {
                    const m = (e.meta ?? {}) as {
                      from?: string;
                      to?: string;
                      reason?: string;
                    };
                    return (
                      <li key={e.id} className="text-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatAuditAction(e.action)}
                          </span>
                          {m.from && m.to && (
                            <span>
                              {m.from} → {m.to}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.actorEmail ?? "Staff"} · {formatDate(e.createdAt)}
                        </div>
                        {m.reason && (
                          <p className="mt-1 whitespace-pre-wrap text-foreground">
                            {m.reason}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatAuditAction(action: string): string {
  const map: Record<string, string> = {
    "registration.start_review": "Started review",
    "registration.approve": "Approved",
    "registration.request_changes": "Requested changes",
    "registration.reject": "Rejected",
    "review.comment": "Added a section comment",
  };
  return map[action] ?? action;
}

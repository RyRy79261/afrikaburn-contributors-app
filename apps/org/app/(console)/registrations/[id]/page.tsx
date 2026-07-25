import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink, Lock, UserPlus } from "lucide-react";
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
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@quagga/types";
import { guardConsole } from "@/lib/gate";
import {
  getRegistrationDetail,
  getRegistrationDecisionLog,
  getRegistrationOfficers,
  type RegistrationDetail,
} from "@/lib/queries";
import {
  classifySoundLevel,
  SOUND_LEVEL_LABELS,
  SOUND_LEVEL_SHORT,
} from "@/lib/org-logic";
import { GROUP_KIND_LABELS, JOINABILITY_LABELS, formatDate } from "@/lib/labels";
import { SupplierStandingBadge } from "@/components/status-badges";
import { FieldList, yesNo, type FieldSpec } from "@/components/field-list";
import { DecisionPanel } from "@/components/decision-panel";
import { SectionReviewThread } from "@/components/section-review-thread";

export const dynamic = "force-dynamic";

const OPERATING_HOURS_LABELS: Record<string, string> = {
  morning: "Morning",
  day: "Day",
  night: "Night",
  late_night: "Late night",
};

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { id } = await params;
  const detail = await getRegistrationDetail(id);
  if (!detail) notFound();

  const decisionLog = await getRegistrationDecisionLog(id);
  const officers = await getRegistrationOfficers(
    detail.group.id,
    detail.edition.id,
  );
  const { registration, group, edition } = detail;

  const fieldsBySection = buildSectionFields(detail, OPERATING_HOURS_LABELS);
  const reviewsBySection = groupReviews(detail);
  const openBySection = Object.fromEntries(
    SECTION_KEYS.map((k) => [
      k,
      reviewsBySection[k].filter((r) => r.status === "open").length,
    ]),
  ) as Record<SectionKey, number>;
  const openThreadTotal = Object.values(openBySection).reduce(
    (a, b) => a + b,
    0,
  );

  // Camp header meta (canvas PRDdG: submitted · campers · sound · cohort).
  const soundShort = SOUND_LEVEL_SHORT[classifySoundLevel(registration.s5AmplifiedMusic)];
  const meta = [
    registration.submittedAt
      ? `Submitted ${formatDate(registration.submittedAt)}`
      : "Not yet submitted",
    registration.s4ExpectedPopulation != null
      ? `${registration.s4ExpectedPopulation} campers`
      : null,
    soundShort !== "—" ? `SOOP ${soundShort}` : null,
    `${detail.cohort === "returning" ? "Returning" : "New"} camp`,
  ].filter(Boolean) as string[];

  return (
    <div>
      {/* Breadcrumb — Console > Registrations > camp */}
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

      {/* Camp header — LEFT-aligned (status pill inline with the title). */}
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
          {SECTION_KEYS.map((key) => {
            const openCount = openBySection[key];
            return (
              <Card key={key} id={key}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">
                    {SECTION_LABELS[key]}
                  </CardTitle>
                  {openCount > 0 ? (
                    <Badge variant="warning">
                      {openCount} OPEN THREAD{openCount > 1 ? "S" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">REVIEWED</Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <FieldList fields={fieldsBySection[key]} />
                  <SectionReviewThread
                    registrationId={registration.id}
                    sectionKey={key}
                    comments={reviewsBySection[key]}
                  />
                </CardContent>
              </Card>
            );
          })}

          {/* Officers — accepted officer registrations share contact with org. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Camp officers</CardTitle>
              <CardDescription>
                Responsible people this camp has registered with AfrikaBurn.
                Contact details appear only for officers who accepted the role.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {officers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No officers have accepted a role for this camp yet.
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
        </div>

        {/* Action rail */}
        <aside className="flex w-full shrink-0 flex-col gap-6 lg:sticky lg:top-6 lg:w-[360px]">
          {/* Decision */}
          <Card className="border-accent/40">
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
              <CardDescription>
                {openThreadTotal > 0
                  ? `Resolve the ${
                      openThreadTotal === 1
                        ? "open thread"
                        : `${openThreadTotal} open threads`
                    } before approving. Approving marks this camp registered for ${edition.name}.`
                  : `Approving marks this camp registered for ${edition.name} and unlocks its entitlements. Transitions are validated against the registration state machine.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <DecisionPanel
                registrationId={registration.id}
                status={registration.status}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Every decision is logged to the audit trail.
              </p>
            </CardContent>
          </Card>

          {/* Assign a wrangler — unlocks after approval (out of scope here). */}
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

function groupReviews(
  detail: RegistrationDetail,
): Record<SectionKey, RegistrationDetail["reviews"]> {
  const out = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, [] as RegistrationDetail["reviews"]]),
  ) as Record<SectionKey, RegistrationDetail["reviews"]>;
  for (const r of detail.reviews) {
    if ((SECTION_KEYS as readonly string[]).includes(r.sectionKey)) {
      out[r.sectionKey as SectionKey].push(r);
    }
  }
  return out;
}

function buildSectionFields(
  detail: RegistrationDetail,
  hoursLabels: Record<string, string>,
): Record<SectionKey, FieldSpec[]> {
  const r = detail.registration;
  const layoutLinks =
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

  const suppliers =
    detail.supplierDeclarations.length > 0 ? (
      <span className="flex flex-col gap-2">
        {detail.supplierDeclarations.map((s) => (
          <span key={s.supplierId} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="font-medium text-foreground">{s.name}</span>
              <SupplierStandingBadge standing={s.standing} />
            </span>
            {s.services && (
              <span className="text-xs text-muted-foreground">
                {s.services}
              </span>
            )}
            {s.note && (
              <span className="text-xs text-muted-foreground">
                Note: {s.note}
              </span>
            )}
          </span>
        ))}
      </span>
    ) : (
      "—"
    );

  return {
    identity: [
      { label: "Camp name", value: detail.group.name },
      { label: "Camp kind", value: GROUP_KIND_LABELS[detail.group.kind] },
      {
        label: "Joinability",
        value:
          JOINABILITY_LABELS[detail.group.joinability] ??
          detail.group.joinability,
      },
      { label: "Contact email", value: r.s1ContactEmail },
      { label: "Description", value: detail.group.description, wide: true },
      { label: "Alt contact name", value: r.s1AltContactName },
      { label: "Alt contact phone", value: r.s1AltContactPhone },
      { label: "Alt contact email", value: r.s1AltContactEmail },
    ],
    lnt: [
      { label: "LNT plan", value: r.s2LntPlan, wide: true },
      { label: "LNT lead name", value: r.s2LntLeadName },
      { label: "LNT lead phone", value: r.s2LntLeadPhone },
      { label: "LNT lead email", value: r.s2LntLeadEmail },
    ],
    participation: [
      { label: "Participation plan", value: r.s3ParticipationPlan, wide: true },
      {
        label: "Operating hours",
        value:
          r.s3OperatingHours.length > 0
            ? r.s3OperatingHours.map((h) => hoursLabels[h] ?? h).join(", ")
            : "—",
      },
      { label: "Gifting food?", value: yesNo(r.s3GiftingFood) },
      { label: "Schedule detail", value: r.s3ScheduleDetail, wide: true },
    ],
    size_logistics: [
      { label: "Expected population", value: r.s4ExpectedPopulation ?? "—" },
      { label: "First arrival", value: formatDate(r.s4FirstArrivalDate) },
      { label: "Work access passes", value: r.s4WorkAccessPasses ?? "—" },
      { label: "Area dimensions", value: r.s4AreaDimensions },
      { label: "Layout uploads", value: layoutLinks, wide: true },
    ],
    sound_placement: [
      {
        label: "Amplified music",
        value: r.s5AmplifiedMusic
          ? `${r.s5AmplifiedMusic} (${SOUND_LEVEL_LABELS[classifySoundLevel(r.s5AmplifiedMusic)]})`
          : "—",
      },
      { label: "Sound plan", value: r.s5SoundPlan, wide: true },
      { label: "Placement — 1st choice", value: r.s5PlacementFirstChoice },
      { label: "Placement — 2nd choice", value: r.s5PlacementSecondChoice },
      { label: "Neighbour request", value: r.s5NeighbourRequest },
      { label: "Family-friendly?", value: r.s5FamilyFriendly },
    ],
    suppliers_commerce: [
      { label: "Declared suppliers", value: suppliers, wide: true },
      { label: "Suppliers note", value: r.s6SuppliersNote, wide: true },
      { label: "Paid performers?", value: yesNo(r.s6PaidPerformers) },
      {
        label: "Expected budget",
        value:
          r.s6ExpectedBudgetZar != null
            ? `ZAR ${r.s6ExpectedBudgetZar.toLocaleString("en-ZA")}`
            : "—",
      },
      { label: "Fee structure", value: r.s6FeeStructure, wide: true },
      { label: "Plug & Play acknowledgement", value: yesNo(r.s6PlugAndPlayAck) },
    ],
  };
}

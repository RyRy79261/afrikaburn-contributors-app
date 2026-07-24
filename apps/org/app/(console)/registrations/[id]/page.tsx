import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
} from "@quagga/types";
import { guardConsole } from "@/lib/gate";
import {
  getRegistrationDetail,
  getRegistrationDecisionLog,
  getRegistrationOfficers,
  type RegistrationDetail,
} from "@/lib/queries";
import { classifySoundLevel, SOUND_LEVEL_LABELS } from "@/lib/org-logic";
import {
  GROUP_KIND_LABELS,
  JOINABILITY_LABELS,
  formatDate,
} from "@/lib/labels";
import { PageHeading } from "@/components/page-heading";
import {
  CohortBadge,
  RegistrationStatusBadge,
  SupplierStandingBadge,
} from "@/components/status-badges";
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
  const officers = await getRegistrationOfficers(detail.group.id, detail.edition.id);
  const { registration, group, edition } = detail;
  const completed = new Set(registration.completedSections);

  const fieldsBySection = buildSectionFields(detail, OPERATING_HOURS_LABELS);
  const reviewsBySection = groupReviews(detail);

  return (
    <div>
      <Link
        href="/registrations"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to registrations
      </Link>

      <PageHeading
        eyebrow={`${GROUP_KIND_LABELS[group.kind] ?? group.kind} · ${edition.name}`}
        title={group.name}
        actions={<RegistrationStatusBadge status={registration.status} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <CohortBadge cohort={detail.cohort} />
        <Badge variant="outline">
          {JOINABILITY_LABELS[group.joinability] ?? group.joinability}
        </Badge>
        {registration.submittedAt && (
          <span>Submitted {formatDate(registration.submittedAt)}</span>
        )}
        {registration.decidedAt && (
          <span>
            · Decided {formatDate(registration.decidedAt)}
            {detail.decidedByEmail ? ` by ${detail.decidedByEmail}` : ""}
          </span>
        )}
      </div>

      {/* Decision panel */}
      <Card className="mb-8 border-accent/40">
        <CardHeader>
          <CardTitle className="text-base">Reviewer decision</CardTitle>
          <CardDescription>
            Approving marks this camp registered for {edition.name} and unlocks
            its entitlements. Transitions are validated against the registration
            state machine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DecisionPanel
            registrationId={registration.id}
            status={registration.status}
          />
        </CardContent>
      </Card>

      {/* Officers — accepted officer registrations share contact with the org */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Camp officers</CardTitle>
          <CardDescription>
            Responsible people this camp has registered with AfrikaBurn. Contact
            details appear only for officers who accepted the role.
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
                    {o.phone && <span className="tabular-nums">{o.phone}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="flex flex-col gap-6">
        {SECTION_KEYS.map((key) => (
          <Card key={key} id={key}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{SECTION_LABELS[key]}</CardTitle>
              <Badge variant={completed.has(key) ? "success" : "outline"}>
                {completed.has(key) ? "Complete" : "Incomplete"}
              </Badge>
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
        ))}
      </div>

      {/* Decision log */}
      {decisionLog.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">Decision history</CardTitle>
            <CardDescription>
              Audit trail of reviewer actions on this registration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {decisionLog.map((e) => {
                const meta = (e.meta ?? {}) as {
                  from?: string;
                  to?: string;
                  reason?: string;
                  sectionKey?: string;
                };
                return (
                  <li key={e.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {formatAuditAction(e.action)}
                      </span>
                      {meta.from && meta.to && (
                        <span>
                          {meta.from} → {meta.to}
                        </span>
                      )}
                      <span>·</span>
                      <span>{e.actorEmail ?? "Staff"}</span>
                      <span>·</span>
                      <span>{formatDate(e.createdAt)}</span>
                    </div>
                    {meta.reason && (
                      <p className="mt-1 whitespace-pre-wrap text-foreground">
                        {meta.reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
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
      { label: "Contact email", value: r.s1ContactEmail },
      {
        label: "Description",
        value: detail.group.description,
        wide: true,
      },
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
      {
        label: "Participation plan",
        value: r.s3ParticipationPlan,
        wide: true,
      },
      {
        label: "Operating hours",
        value:
          r.s3OperatingHours.length > 0
            ? r.s3OperatingHours
                .map((h) => hoursLabels[h] ?? h)
                .join(", ")
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
      {
        label: "Plug & Play acknowledgement",
        value: yesNo(r.s6PlugAndPlayAck),
      },
    ],
  };
}

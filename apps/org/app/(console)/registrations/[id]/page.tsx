import { notFound } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type QuestionnaireResponses,
} from "@quagga/types";
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
import {
  asProjectKind,
  getProjectRegistrationAnswers,
} from "@/lib/project-registration";
import {
  ARTWORK_POWER_LABELS,
  VEHICLE_ACK_LABELS,
  buildProjectMeta,
  buildProjectSections,
  officersCopy,
  PROJECT_SUBJECT_NOUN,
  type ProjectField,
  type ProjectRegistrationView,
} from "@/lib/project-review";
import { SupplierStandingBadge } from "@/components/status-badges";
import { yesNo, type FieldSpec } from "@/components/field-list";
import {
  RegistrationReview,
  type ReviewSectionView,
} from "@/components/registration-review";

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

  const [decisionLog, officers] = await Promise.all([
    getRegistrationDecisionLog(id),
    getRegistrationOfficers(detail.group.id, detail.edition.id),
  ]);

  const projectKind = asProjectKind(detail.group.kind);

  if (projectKind) {
    // Mutant-vehicle / artwork: the camp six-section shape can't honestly hold
    // these answers, so we render a kind-specific layout. The camp-shaped
    // `registrations` columns that stay TRUE for a project are read straight;
    // everything else comes from the authored answer payload.
    const { registration } = detail;
    const answers: QuestionnaireResponses | null =
      await getProjectRegistrationAnswers(detail.group.id, projectKind);

    const view: ProjectRegistrationView = {
      contactEmail: registration.s1ContactEmail,
      areaDimensions: registration.s4AreaDimensions,
      imageUrls: registration.s4LayoutUploadUrls,
      soundRaw: registration.s5AmplifiedMusic,
      placementNotes: registration.s5PlacementFirstChoice,
      lntPlan: registration.s2LntPlan,
      grantsInterest: registration.grantsInterest,
    };

    const sections: ReviewSectionView[] = buildProjectSections(
      projectKind,
      detail.group.name,
      view,
      answers,
    ).map((s) => ({
      key: s.key,
      label: s.label,
      fields: s.fields.map(renderProjectField),
    }));

    const meta = buildProjectMeta(projectKind, {
      submittedAt: registration.submittedAt,
      cohort: detail.cohort,
      view,
      answers,
    });

    return (
      <RegistrationReview
        detail={detail}
        decisionLog={decisionLog}
        officers={officers}
        sections={sections}
        meta={meta}
        subjectNoun={PROJECT_SUBJECT_NOUN[detail.group.kind] ?? "project"}
        officersCopy={officersCopy(detail.group.kind)}
        showWrangler={false}
      />
    );
  }

  // Theme camp — the original six-section review, untouched.
  const { registration } = detail;
  const fieldsBySection = buildSectionFields(detail, OPERATING_HOURS_LABELS);
  const sections: ReviewSectionView[] = SECTION_KEYS.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    fields: fieldsBySection[key],
  }));

  // Camp header meta (canvas PRDdG: submitted · campers · sound · cohort).
  const soundShort =
    SOUND_LEVEL_SHORT[classifySoundLevel(registration.s5AmplifiedMusic)];
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
    <RegistrationReview
      detail={detail}
      decisionLog={decisionLog}
      officers={officers}
      sections={sections}
      meta={meta}
      subjectNoun="camp"
      officersCopy={officersCopy("theme_camp")}
      showWrangler
    />
  );
}

/** Render a structured project field to a `FieldSpec` (JSX for uploads/acks). */
function renderProjectField(field: ProjectField): FieldSpec {
  const { value } = field;
  switch (value.type) {
    case "text":
      return { label: field.label, value: value.value ?? "—", wide: field.wide };
    case "yesno":
      return { label: field.label, value: yesNo(value.value), wide: field.wide };
    case "uploads":
      return {
        label: field.label,
        wide: field.wide,
        value:
          value.urls.length > 0 ? (
            <span className="flex flex-col gap-1">
              {value.urls.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  {value.noun} {i + 1}
                </a>
              ))}
            </span>
          ) : (
            "—"
          ),
      };
    case "acks": {
      const acked = new Set(value.ackedKeys);
      return {
        label: field.label,
        wide: field.wide,
        value: (
          <span className="flex flex-col gap-1.5">
            {VEHICLE_ACK_LABELS.map((ack) => {
              const ok = acked.has(ack.key);
              return (
                <span key={ack.key} className="flex items-start gap-1.5">
                  {ok ? (
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <X
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span
                    className={ok ? undefined : "text-muted-foreground"}
                  >
                    {ack.label}
                  </span>
                </span>
              );
            })}
          </span>
        ),
      };
    }
    case "power":
      return {
        label: field.label,
        wide: field.wide,
        value:
          value.keys.length > 0
            ? value.keys.map((k) => ARTWORK_POWER_LABELS[k] ?? k).join(", ")
            : "—",
      };
  }
}

function buildSectionFields(
  detail: RegistrationDetail,
  hoursLabels: Record<string, string>,
): Record<(typeof SECTION_KEYS)[number], FieldSpec[]> {
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

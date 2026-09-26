import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { SectionKey } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import type {
  DeclaredSupplier,
  RegistrationRow,
} from "@/lib/registration-store";

// A registration's answers, section by section, as label/value pairs. Shared by
// the locked post-submission summary and the read-only "Past registrations"
// view (epic #50) so the two can never show the same row two different ways.

const HOURS_LABEL: Record<string, string> = {
  morning: "Morning",
  day: "Day",
  night: "Night",
  late_night: "Late night",
};

function yesNo(v: boolean | null): string {
  if (v === null) return "—";
  return v ? "Yes" : "No";
}

function text(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v : "—";
}

export interface Field {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}

/**
 * Every answer on a registration, grouped by section, ready to render.
 *
 * `description` is `undefined` to omit the row entirely (a past edition — see
 * below); `null` renders the usual "—".
 */
export function registrationFieldsBySection({
  registration: r,
  campName,
  description,
  declaredSuppliers,
}: {
  registration: RegistrationRow;
  campName: string;
  description: string | null | undefined;
  declaredSuppliers: DeclaredSupplier[];
}): Record<SectionKey, Field[]> {
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

  // Declared suppliers are shown WHOLE. A suspended one is marked, never
  // dropped: this list is the record of what the camp submitted, and quietly
  // shortening it left a camp reading its own registration back with a supplier
  // missing and no explanation.
  const anySuspended = declaredSuppliers.some(
    (s) => s.standing === "suspended",
  );
  const suppliers =
    declaredSuppliers.length > 0 ? (
      <span className="flex flex-col gap-1">
        {declaredSuppliers.map((s) => (
          <span key={s.id} className="flex flex-wrap items-center gap-2">
            {s.name}
            {s.standing === "suspended" && (
              <Badge variant="warning">Suspended</Badge>
            )}
          </span>
        ))}
        {anySuspended && (
          <span className="mt-1 text-xs text-muted-foreground">
            AfrikaBurn has suspended a supplier you declared. Talk to the camp
            liaison before relying on them for this edition.
          </span>
        )}
      </span>
    ) : (
      "—"
    );

  return {
    identity: [
      { label: "Camp name", value: campName },
      // The description lives on the CAMP, not the registration, so it is
      // today's text. A past registration omits it rather than present this
      // year's words as what was submitted then.
      ...(description === undefined
        ? []
        : [{ label: "Description", value: text(description), wide: true }]),
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
}

/** A section's answers as a definition list. */
export function RegistrationAnswerList({ fields }: { fields: Field[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className={f.wide ? "sm:col-span-2" : undefined}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {f.label}
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

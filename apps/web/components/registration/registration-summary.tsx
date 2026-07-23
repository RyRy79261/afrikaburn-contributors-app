import * as React from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileClock,
  Hourglass,
  MessageSquare,
  XCircle,
} from "lucide-react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type RegistrationStatus,
  type SectionKey,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import type {
  CampSectionReview,
  RegistrationRow,
} from "@/lib/registration-store";

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
}: {
  registration: RegistrationRow;
  campName: string;
  description: string | null;
  supplierNames: string[];
  reviews: CampSectionReview[];
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

  const suppliers =
    supplierNames.length > 0 ? supplierNames.join(", ") : "—";

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
      { label: "Placement — 1st choice", value: text(r.s5PlacementFirstChoice) },
      { label: "Placement — 2nd choice", value: text(r.s5PlacementSecondChoice) },
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
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${banner.tone}`}>
        <span className="mt-0.5 shrink-0">{banner.icon}</span>
        <div>
          <p className="text-sm font-medium">{banner.title}</p>
          <p className="mt-0.5 text-sm opacity-80">{banner.body}</p>
        </div>
      </div>

      {SECTION_KEYS.map((key) => {
        const secReviews = reviewsBySection.get(key) ?? [];
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{SECTION_LABELS[key]}</CardTitle>
            </CardHeader>
            <CardContent>
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

              {secReviews.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AfrikaBurn feedback
                  </p>
                  <ul className="flex flex-col gap-2">
                    {secReviews.map((rev) => (
                      <li
                        key={rev.id}
                        className="rounded-lg border border-border bg-secondary/40 p-3 text-sm"
                      >
                        <Badge
                          variant={rev.status === "open" ? "warning" : "success"}
                        >
                          {rev.status === "open" ? "Open" : "Resolved"}
                        </Badge>
                        <p className="mt-1.5 whitespace-pre-wrap text-foreground">
                          {rev.comment}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

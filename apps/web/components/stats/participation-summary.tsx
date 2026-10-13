import { History, Info } from "lucide-react";
import type { MembershipRole } from "@quagga/types";
import type { MemberParticipation, OnboardingStatus } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { cn } from "@quagga/ui/lib/utils";
import { onboardingLine, passLine } from "@/lib/participation-lines";
import { StatTile } from "./stat-tile";

// A member's participation summary (docs/camp-stats-spec.md §Per person):
//   · frame C2 — on a burner's profile, for a roster viewer of the camp
//     (`audience="viewer"`, wide);
//   · frame C3 — "Your participation" on the camp page, for the member
//     themself (`audience="self"`, the narrow sidebar column).
// PRESENTATIONAL ONLY. Everything here came out of @quagga/core
// `buildMemberParticipation`, which already refused anyone else and already
// projected the two bio figures through the viewer's own view of the bio —
// a null there is the privacy outcome, rendered as "not shared".

const STRUCTURAL_LABEL: Partial<Record<MembershipRole, string>> = {
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

const ONBOARDING_LABEL: Record<OnboardingStatus | "waived", string> = {
  completed: "Done",
  in_progress: "In progress",
  not_started: "Not started",
  waived: "Waived",
};

function buildStrikeLine(
  plans: MemberParticipation["buildStrike"],
  self: boolean,
): string {
  if (!plans)
    return self ? "You haven't set your plans yet" : "No plans set yet";
  if (plans.joiningBuild && plans.joiningStrike)
    return "Joining build and strike";
  if (plans.joiningBuild) return "Joining build";
  if (plans.joiningStrike) return "Joining strike";
  return "Not joining build or strike";
}

function Row({
  label,
  wide,
  children,
}: {
  label: string;
  wide: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 py-3",
        wide && "sm:grid sm:grid-cols-[13rem_1fr] sm:items-center sm:gap-4",
      )}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ParticipationSummary({
  participation: p,
  audience,
  campName,
  subjectName,
}: {
  participation: MemberParticipation;
  audience: "self" | "viewer";
  campName: string;
  /** The member's display name (viewer audience). */
  subjectName?: string;
}) {
  const self = audience === "self";
  const wide = !self;
  const notShared = self ? "Not in your bio" : "Not shared";
  const structural = STRUCTURAL_LABEL[p.roles.structural] ?? null;
  const onboarding = onboardingLine(p.onboarding, self);

  return (
    <Card data-testid={self ? "your-participation" : "member-participation"}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-accent" aria-hidden />
          {self ? "Your participation" : `Participation at ${campName}`}
        </CardTitle>
        <CardDescription>
          {self
            ? "What the camp's records say about you. The camp's leads see the same summary."
            : `From the camp's records. Burns attended and skills come from ${subjectName ?? "the member"}'s bio, only as far as the roster already shows them.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className={cn("grid grid-cols-2 gap-3", wide && "sm:grid-cols-4")}>
          <StatTile
            label="Burns attended"
            value={p.burnsAttended ?? "—"}
            hint={
              p.burnsAttended === null
                ? notShared
                : self
                  ? "From your bio"
                  : "From the bio"
            }
          />
          <StatTile
            label="With the camp since"
            value={p.withCampSince}
            hint="Membership began"
          />
          <StatTile
            label="Shifts held"
            value={p.shiftsHeldThisEdition}
            hint="This edition"
          />
          <StatTile
            label="Shifts held before"
            value={p.shiftsHeldEarlier}
            hint="Earlier editions"
          />
        </div>

        <dl className="flex flex-col divide-y divide-border">
          <Row label="Build and strike" wide={wide}>
            {buildStrikeLine(p.buildStrike, self)}
          </Row>
          <Row label="Onboarding" wide={wide}>
            {"badge" in onboarding ? (
              <Badge
                variant={
                  onboarding.badge === "completed" ? "success" : "secondary"
                }
              >
                {ONBOARDING_LABEL[onboarding.badge]}
              </Badge>
            ) : (
              <span className="text-muted-foreground">{onboarding.text}</span>
            )}
          </Row>
          <Row label="Roles now" wide={wide}>
            <span className="flex flex-wrap gap-1.5">
              {structural && <Badge variant="outline">{structural}</Badge>}
              {p.roles.projectRoles.map((r) => (
                <Badge key={r.id} variant="secondary">
                  {r.name}
                </Badge>
              ))}
            </span>
          </Row>
          <Row label="Skills" wide={wide}>
            {p.skills === null ? (
              <span className="text-muted-foreground">{notShared}</span>
            ) : p.skills.length === 0 ? (
              <span className="text-muted-foreground">None listed</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {p.skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </span>
            )}
          </Row>
          <Row label="Work Access Pass" wide={wide}>
            {passLine(p.passes)}
          </Row>
        </dl>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Held means a spot on a shift whose day has passed. There&apos;s no
          attendance record, so it isn&apos;t a count of shifts worked.
        </p>
      </CardContent>
    </Card>
  );
}

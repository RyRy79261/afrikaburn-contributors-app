import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  Clock,
  Lock,
  History,
} from "lucide-react";
import {
  canAuthorOnboarding,
  canAuthorProjectQuestionnaire,
  defaultOnboardingAudience,
  describeOnboardingAudience,
  hasProjectPermission,
  isOnboardingDefinition,
  ONBOARDING_GROUP_KINDS,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { RoleBadge } from "@quagga/ui/components/role-badge";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import {
  listProjectQuestionnaires,
  getActivation,
  getActivationResults,
} from "@/lib/questionnaire-store";
import {
  listRoles,
  getRoleAssignments,
  getMemberPermissions,
  type ProjectRole,
} from "@/lib/roles-store";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { CloseQuestionnaireButton } from "@/components/questionnaire/close-questionnaire-button";
import { closeQuestionnaireAction } from "@/app/(app)/camps/[slug]/questionnaires/actions";
import { carryForwardOnboardingAction } from "@/app/(app)/camps/[slug]/questionnaires/onboarding-actions";
import { CarryForwardButton } from "@/components/questionnaire/carry-forward-button";
import {
  findOnboardingCarrySource,
  getOnboardingCompletion,
  listOnboardingsForEdition,
} from "@/lib/onboarding-store";
import {
  resolveQuestionnaireRoute,
  type QuestionnaireRouteKind,
} from "./guard";

/** How the page refers to the group, by kind. */
const GROUP_NOUN: Record<string, string> = {
  theme_camp: "camp",
  artwork: "art project",
  mutant_vehicle: "vehicle crew",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  closed: "Closed",
};

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The questionnaires list for one group — a theme camp, an artwork or a mutant
 * vehicle (CREATIVE-007). The questionnaire spine is kind-agnostic; the route
 * a group is reached on is not, so `routeKind` names which route rendered this
 * and `resolveQuestionnaireRoute` refuses (or redirects) a slug of another kind.
 */
export async function ProjectQuestionnairesList({
  slug,
  routeKind,
}: {
  slug: string;
  routeKind: QuestionnaireRouteKind;
}) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp questionnaires" />;
  }

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return <PreviewNotice feature="Camp questionnaires" />;
  }

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();
  const base = resolveQuestionnaireRoute(camp.kind, routeKind, slug, "");

  // Access + CTA: lead/admin OR any member holding `manage_questionnaires`
  // (questionnaire-spec §"Roles v2"). UI hiding is never the security boundary —
  // the create action re-enforces the audience scope server-side.
  const viewerPerms = await getMemberPermissions(camp.id, user.id);
  if (
    !viewerPerms ||
    !hasProjectPermission(viewerPerms, "manage_questionnaires")
  ) {
    notFound();
  }
  const isAdmin = camp.viewerRole === "lead" || camp.viewerRole === "admin";

  const questionnaires = await listProjectQuestionnaires(camp.id);

  // Roles → the audience-by-role legend + per-member chips (colors are the
  // role's own data-colors, passed straight through to RoleBadge).
  const roles = await listRoles(camp.id);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const baselineRole = roles.find((r) => r.kind === "baseline") ?? null;
  const legendRoles = roles.filter((r) => r.kind !== "officer");

  const assignments = await getRoleAssignments(camp.id);
  const chipsByUserId = new Map<string, ProjectRole[]>();
  for (const m of camp.members) {
    const accepted = (assignments.get(m.membershipId) ?? [])
      .filter((a) => a.consent === "accepted")
      .map((a) => roleById.get(a.projectRoleId))
      .filter((r): r is ProjectRole => Boolean(r))
      .filter((r) => r.kind !== "officer" && r.kind !== "baseline");
    const chips =
      accepted.length > 0 ? accepted : baselineRole ? [baselineRole] : [];
    chipsByUserId.set(m.userId, chips);
  }

  // Per-questionnaire completion detail (member rows + resolved audience).
  // An ONBOARDING is resolved without its respondents: its card shows totals
  // only and names are loaded on demand on its completion view (ONBOARD-020).
  const details = await Promise.all(
    questionnaires.map(async (q) => {
      const activation = await getActivation(q.activationId);
      if (activation && isOnboardingDefinition(activation.definition)) {
        return { activation, respondents: [] };
      }
      return getActivationResults(q.activationId, edition.id);
    }),
  );
  const detailById = new Map(
    questionnaires.map((q, i) => [q.activationId, details[i]] as const),
  );

  // Camp onboarding (epic #54). Its card shows TOTALS ONLY — names live
  // behind "Show names" on its completion view (ONBOARD-020) — and counts the
  // camp's current members, exactly as that view does.
  const onboardingIds = new Set(
    questionnaires
      .filter((q) =>
        isOnboardingDefinition(detailById.get(q.activationId)?.activation.definition),
      )
      .map((q) => q.activationId),
  );
  const onboardingTotals = new Map(
    await Promise.all(
      questionnaires
        .filter((q) => onboardingIds.has(q.activationId) && q.status !== "draft")
        .map(
          async (q) =>
            [
              q.activationId,
              (
                await getOnboardingCompletion({
                  activationId: q.activationId,
                  groupId: camp.id,
                  names: null,
                })
              )?.totals ?? null,
            ] as const,
        ),
    ),
  );
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

  // Carry forward (ONBOARD-022): offered when this edition has no onboarding
  // yet and an earlier edition's was sent — to someone who may author one.
  const offersOnboarding =
    ONBOARDING_GROUP_KINDS.includes(camp.kind) &&
    canAuthorOnboarding(
      viewerPerms,
      camp.kind,
      defaultOnboardingAudience(camp.id),
      false,
      baselineRole?.id ?? null,
    );
  const carrySource =
    offersOnboarding &&
    (await listOnboardingsForEdition(camp.id, edition.id)).length === 0
      ? await findOnboardingCarrySource(camp.id, edition.year)
      : null;

  function audienceLabel(activationId: string): string {
    const aud = detailById.get(activationId)?.activation.audience;
    if (!aud || aud.kind !== "project") return "the camp";
    if (onboardingIds.has(activationId)) {
      return describeOnboardingAudience(aud, roleNameById);
    }
    if (aud.mode === "everyone") return "everyone";
    const names = aud.roleIds
      .map((id) => roleById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(" & ") : "selected roles";
  }

  // Why this viewer may not close each questionnaire (null = they may).
  // Recalling a send is the same authority as making it, so it runs the same
  // scope predicate the send ran — against the audience it actually went to.
  const closeRefusalById = new Map<string, string | null>(
    questionnaires.map((q) => {
      const activation = detailById.get(q.activationId)?.activation;
      const aud = activation?.audience;
      if (!activation || aud?.kind !== "project") {
        return [
          q.activationId,
          "Only this camp's own questionnaires can be closed here.",
        ] as const;
      }
      const allowed = canAuthorProjectQuestionnaire(
        viewerPerms,
        aud,
        activation.blocking,
        baselineRole?.id ?? null,
      );
      return [
        q.activationId,
        allowed
          ? null
          : "Outside your questionnaire permissions — a lead or admin can close it.",
      ] as const;
    }),
  );

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <Link
                  href={`/camps/${slug}`}
                  className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {camp.name}
                </Link>
                <span aria-hidden> / Questionnaires</span>
              </p>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Questionnaires
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask your {GROUP_NOUN[camp.kind] ?? "camp"} something and track
                  who has answered.
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus className="h-4 w-4" aria-hidden />
                New questionnaire
              </Link>
            </Button>
          </div>

          {legendRoles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Audience by role:
              </span>
              {legendRoles.map((r) => (
                <RoleBadge
                  key={r.id}
                  name={r.name}
                  color={r.color}
                  emoji={r.emoji}
                />
              ))}
            </div>
          )}
        </div>

        {carrySource && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-accent" aria-hidden />
                Last year&apos;s onboarding is ready to reuse
              </CardTitle>
              <CardDescription>
                &ldquo;{carrySource.title}&rdquo; ran for{" "}
                {carrySource.editionName} — {carrySource.complete} of{" "}
                {carrySource.sent} finished it. Carry it forward and it comes
                back as a draft you can edit. Nothing is sent until you press
                Send.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <CarryForwardButton
                slug={slug}
                sourceActivationId={carrySource.activationId}
                editionName={carrySource.editionName}
                action={carryForwardOnboardingAction}
              />
              <Button asChild variant="ghost">
                <Link href={`${base}/new`}>Start fresh</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {questionnaires.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No questionnaires yet"
            description="Create one to gather build-week preferences, dietary needs, shift availability — whatever your camp actually needs."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {questionnaires.map((q) => {
              if (onboardingIds.has(q.activationId)) {
                const totals = onboardingTotals.get(q.activationId) ?? null;
                const isDraft = q.status === "draft";
                const meta = isDraft
                  ? "Draft — not sent yet. Nobody sees it until you press Send."
                  : [
                      `Sent to ${audienceLabel(q.activationId)}`,
                      q.dueAt ? `due ${fmtDate(q.dueAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                return (
                  <Card key={q.activationId} data-testid="onboarding-card">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{q.title}</CardTitle>
                            <Badge variant="secondary">Onboarding</Badge>
                            {q.status !== "open" && (
                              <Badge variant="outline">
                                {STATUS_LABEL[q.status] ?? q.status}
                              </Badge>
                            )}
                          </div>
                          <CardDescription>{meta}</CardDescription>
                        </div>
                        <BlockingBadge blocking={q.blocking} />
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {totals && (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {totals.complete} of {totals.total} complete
                            </span>
                            <span>{totals.percent}%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${totals.percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {isDraft ? (
                          <Button asChild size="sm">
                            <Link href={`${base}/onboarding/${q.activationId}`}>
                              Continue editing
                            </Link>
                          </Button>
                        ) : (
                          isAdmin && (
                            <Button asChild variant="outline" size="sm">
                              <Link href={`${base}/${q.activationId}`}>
                                View completion
                              </Link>
                            </Button>
                          )
                        )}
                        {q.status === "open" && (
                          <CloseQuestionnaireButton
                            slug={slug}
                            activationId={q.activationId}
                            blocking={q.blocking}
                            refusal={closeRefusalById.get(q.activationId)}
                            action={closeQuestionnaireAction}
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              }
              const pct =
                q.sent > 0 ? Math.round((q.completed / q.sent) * 100) : 0;
              const respondents =
                detailById.get(q.activationId)?.respondents ?? [];
              const statusLabel =
                q.status !== "open" ? STATUS_LABEL[q.status] : null;
              const meta = [
                `Sent to ${audienceLabel(q.activationId)}`,
                q.dueAt ? `due ${fmtDate(q.dueAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <Card key={q.activationId}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base">{q.title}</CardTitle>
                          {statusLabel && (
                            <Badge variant="outline">{statusLabel}</Badge>
                          )}
                        </div>
                        <CardDescription>{meta}</CardDescription>
                      </div>
                      <BlockingBadge blocking={q.blocking} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {q.completed} of {q.sent} complete
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {respondents.length > 0 ? (
                      <ul className="flex flex-col divide-y divide-border">
                        {respondents.map((r) => {
                          const done = r.status === "completed";
                          // Closing the questionnaire expires whoever hadn't
                          // answered — say "recalled", not "pending": nobody is
                          // waiting on them any more.
                          const recalled = r.status === "expired";
                          const chips = chipsByUserId.get(r.userId) ?? [];
                          return (
                            <li
                              key={r.userId}
                              className="flex items-center gap-3 py-2.5"
                            >
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                                aria-hidden
                              >
                                {initials(r.displayName)}
                              </span>
                              <span className="min-w-0 truncate text-sm">
                                {r.displayName}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {chips.map((c) => (
                                  <RoleBadge
                                    key={c.id}
                                    name={c.name}
                                    color={c.color}
                                    emoji={c.emoji}
                                  />
                                ))}
                              </div>
                              <div className="ml-auto shrink-0">
                                {done ? (
                                  <Badge variant="success">
                                    Done
                                    <CheckCircle2
                                      className="h-3 w-3"
                                      aria-hidden
                                    />
                                  </Badge>
                                ) : recalled ? (
                                  <Badge variant="outline">
                                    <Lock className="h-3 w-3" aria-hidden />
                                    Recalled
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">
                                    <Clock className="h-3 w-3" aria-hidden />
                                    Pending
                                  </Badge>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        This questionnaire&apos;s audience resolved to nobody at
                        send time.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${base}/${q.activationId}`}>
                            View responses
                          </Link>
                        </Button>
                      )}
                      {q.status === "open" && (
                        <CloseQuestionnaireButton
                          slug={slug}
                          activationId={q.activationId}
                          blocking={q.blocking}
                          refusal={closeRefusalById.get(q.activationId)}
                          action={closeQuestionnaireAction}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

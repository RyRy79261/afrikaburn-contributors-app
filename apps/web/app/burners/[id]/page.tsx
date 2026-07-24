import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Pencil, ShieldCheck, Tent } from "lucide-react";
import { initialsFromName } from "@quagga/core";
import { volunteerPortfolioLabel } from "@quagga/types";
import type { GroupKind, MembershipRole } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getPublicBurnerProfile } from "@/lib/groups-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";

export const dynamic = "force-dynamic";

// Zod-validate the dynamic segment at the boundary (build-spec §Hard constraints
// 6). User ids are uuids; anything else is a 404, not a query.
const ParamsSchema = z.object({ id: z.string().uuid() });

const KIND_LABEL: Record<GroupKind, string> = {
  org: "AfrikaBurn",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "God",
  org_staff: "Org staff",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

export default async function BurnerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { id } = parsed.data;

  // Requires a signed-in session like the rest of the app — no auth bypass.
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Burner profiles" />
      </AppShell>
    );
  }

  const viewer = await ensureCampUser(authUser);
  const edition = await getActiveEdition();
  if (!viewer || !edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Burner profiles" />
      </AppShell>
    );
  }

  const profile = await getPublicBurnerProfile(id, edition.id);
  if (!profile) notFound();

  const isOwn = profile.userId === viewer.id;
  const initials = initialsFromName(profile.displayName);
  const pf = profile.publicFields;

  const hasYears = pf.attendedYears.length > 0;
  const hasSkills = pf.skills.length > 0;
  const volunteeringLabels = pf.volunteeringInterests.map(volunteerPortfolioLabel);
  const hasVolunteering =
    volunteeringLabels.length > 0 || Boolean(pf.volunteeringOther);
  const hasRanger =
    pf.rangerTraining || pf.rangerCurious || pf.greenDotTraining;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-foreground"
              aria-hidden
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
                Burner
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                {profile.displayName}
              </h1>
              {pf.homeCity && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {pf.homeCity}
                </p>
              )}
            </div>
          </div>
          {isOwn && (
            <Button asChild variant="outline" size="sm">
              <Link href="/profile">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit your bio
              </Link>
            </Button>
          )}
        </header>

        {pf.bio && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {pf.bio}
              </p>
            </CardContent>
          </Card>
        )}

        {pf.about && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">For the burns</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {pf.about}
              </p>
            </CardContent>
          </Card>
        )}

        {(hasSkills || hasYears || pf.firstTime === true) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">On the playa</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {hasSkills && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pf.skills.map((skill) => (
                      <Badge key={skill} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {(hasYears || pf.firstTime === true) && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Years attended
                  </p>
                  {hasYears ? (
                    <div className="flex flex-wrap gap-1.5">
                      {pf.attendedYears.map((year) => (
                        <Badge key={year} variant="outline">
                          {year}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="outline">First AfrikaBurn</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {profile.campHistory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Tent className="h-4 w-4 text-accent" aria-hidden />
                Camp history
              </CardTitle>
              <CardDescription>
                Camps this burner has been part of.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {profile.campHistory.map((entry, i) => (
                  <li
                    key={`${entry.label}-${i}`}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {/* Linked entries link out ONLY when the camp is
                          registered — free camps stay undiscoverable. */}
                      {entry.kind === "linked" &&
                      entry.registered &&
                      entry.slug ? (
                        <Link
                          href={`/camps/${entry.slug}`}
                          className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {entry.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{entry.label}</span>
                      )}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {entry.event ?? "AfrikaBurn"}
                        {entry.years ? ` · ${entry.years}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {hasVolunteering && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volunteering interests</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {volunteeringLabels.map((label) => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))}
              {pf.volunteeringOther && (
                <Badge variant="outline">{pf.volunteeringOther}</Badge>
              )}
            </CardContent>
          </Card>
        )}

        {hasRanger && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
                Rangers
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {pf.rangerTraining && (
                <Badge variant="success">Dust Ranger trained</Badge>
              )}
              {pf.rangerCurious && (
                <Badge variant="secondary">Curious about shifts</Badge>
              )}
              {pf.greenDotTraining && (
                <Badge variant="success">Green Dot trained</Badge>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tent className="h-4 w-4 text-accent" aria-hidden />
              Camps
            </CardTitle>
            <CardDescription>
              Registered camps this burner belongs to.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profile.camps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not a member of any registered camp yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {profile.camps.map((camp) => (
                  <li
                    key={camp.slug}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-sm">
                      <Link
                        href={`/camps/${camp.slug}`}
                        className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {camp.name}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {KIND_LABEL[camp.kind]}
                      </span>
                    </span>
                    <Badge
                      variant={
                        camp.role === "lead"
                          ? "default"
                          : camp.role === "admin"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {ROLE_LABEL[camp.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Private details are never shown to other burners.
        </p>
      </div>
    </AppShell>
  );
}

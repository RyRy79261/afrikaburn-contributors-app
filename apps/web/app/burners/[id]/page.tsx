import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Pencil, ShieldCheck } from "lucide-react";
import { publicMemberName } from "@quagga/core";
import { volunteerPortfolioLabel } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getPublicBurnerProfile } from "@/lib/groups-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { ProfileHero } from "@/components/profile-public/profile-hero";
import { ProfileSection } from "@/components/profile-public/profile-section";
import { ProfileCamps } from "@/components/profile-public/profile-camps";
import { PrivacyNote } from "@/components/profile-public/privacy-note";

export const dynamic = "force-dynamic";

// Third-party burner profile (canvas `mm31G` desktop / `lYUEe` mobile). The
// PRIVACY BOUNDARY IS THE SERVER: `getPublicBurnerProfile` never selects the
// hard-locked columns (phone, emergency contacts, medical, encrypted ID) and
// projects what it does load through `publicBioView`, which additionally gates
// every field on `canBePublic` + the owner's flag. Free-camp memberships are
// filtered out there too (the undiscoverability law). This page therefore has
// no privacy logic of its own — a field it cannot render is a field it was
// never given.

// Zod-validate the dynamic segment at the boundary (build-spec §Hard constraints
// 6). User ids are uuids; anything else is a 404, not a query.
const ParamsSchema = z.object({ id: z.string().uuid() });

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
  const pf = profile.publicFields;

  // The display name is a FLAGGABLE field like any other: a burner who marked
  // it private renders as the neutral placeholder to third parties (camp member
  // lists are a different surface — there, camp-mates always see names).
  // `publicMemberName` guarantees the fallback is never the account email.
  const heading = publicMemberName(pf.displayName);

  const about = pf.about ?? pf.bio;
  const volunteeringLabels = pf.volunteeringInterests.map(volunteerPortfolioLabel);
  const hasVolunteering =
    volunteeringLabels.length > 0 || Boolean(pf.volunteeringOther);
  const hasRanger =
    pf.rangerTraining || pf.rangerCurious || pf.greenDotTraining;
  const hasCamps = profile.camps.length > 0 || profile.campHistory.length > 0;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <ProfileHero
          displayName={heading}
          homeCity={pf.homeCity}
          burnsCount={pf.attendedYears.length > 0 ? pf.attendedYears.length : null}
          firstTime={pf.firstTime}
          action={
            isOwn ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/profile">
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit your bio
                </Link>
              </Button>
            ) : null
          }
        />

        {about && (
          <ProfileSection label="About">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {about}
            </p>
          </ProfileSection>
        )}

        {pf.attendedYears.length > 0 && (
          <ProfileSection label="Years attended">
            <div className="flex flex-wrap gap-1.5">
              {[...pf.attendedYears]
                .sort((a, b) => a - b)
                .map((year) => (
                  <Badge key={year} variant="outline" className="tabular-nums">
                    {year}
                  </Badge>
                ))}
            </div>
          </ProfileSection>
        )}

        {pf.skills.length > 0 && (
          <ProfileSection label="Skills">
            <div className="flex flex-wrap gap-1.5">
              {pf.skills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))}
            </div>
          </ProfileSection>
        )}

        {hasCamps && (
          <ProfileSection label="Camps">
            <ProfileCamps
              camps={profile.camps}
              campHistory={profile.campHistory}
            />
          </ProfileSection>
        )}

        {hasVolunteering && (
          <ProfileSection label="Volunteering">
            <div className="flex flex-wrap gap-1.5">
              {volunteeringLabels.map((label) => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))}
              {pf.volunteeringOther && (
                <Badge variant="outline">{pf.volunteeringOther}</Badge>
              )}
            </div>
          </ProfileSection>
        )}

        {hasRanger && (
          <ProfileSection
            label="Rangers"
            icon={<ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />}
          >
            <div className="flex flex-wrap gap-1.5">
              {pf.rangerTraining && (
                <Badge variant="success">Dust Ranger trained</Badge>
              )}
              {pf.greenDotTraining && (
                <Badge variant="success">Green Dot trained</Badge>
              )}
              {pf.rangerCurious && (
                <Badge variant="secondary">Curious about rangering</Badge>
              )}
            </div>
          </ProfileSection>
        )}

        <PrivacyNote />
      </div>
    </AppShell>
  );
}

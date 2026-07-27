import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Pencil, ShieldCheck, Stethoscope } from "lucide-react";
import { volunteerPortfolioLabel } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getPublicBurnerProfile } from "@/lib/groups-store";
import { resolveMedicalNotesForViewer } from "@/lib/medical-access";
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
//
// ONE exception, server-resolved the same way: MEDICAL NOTES. They are never
// public, but they ARE visible to the audience the burner disclosed them to —
// their own camp's leads and AfrikaBurn's safety/org staff — which is exactly
// what the field's label says at the point of entry. This member DETAIL view is
// the only place they render (never a roster, never an export);
// `resolveMedicalNotesForViewer` re-derives the authz from memberships
// server-side and audits the read.

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
    return <PreviewNotice feature="Burner profiles" />;
  }

  const viewer = await ensureCampUser(authUser);
  const edition = await getActiveEdition();
  if (!viewer || !edition) {
    return <PreviewNotice feature="Burner profiles" />;
  }

  const profile = await getPublicBurnerProfile(id, edition.id);
  if (!profile) notFound();

  const medical = await resolveMedicalNotesForViewer({
    viewerUserId: viewer.id,
    subjectUserId: profile.userId,
    editionId: edition.id,
  });

  const isOwn = profile.userId === viewer.id;
  const pf = profile.publicFields;

  // The username is a public handle by construction — unique, no privacy toggle
  // (see @quagga/core `username.ts`) — so it needs no flag check here; the
  // resolver already ran it through `publicMemberName`, which guarantees the
  // fallback is a neutral placeholder and never the account email or legal name.
  const heading = profile.displayName;

  const about = pf.about ?? pf.bio;
  const volunteeringLabels = pf.volunteeringInterests.map(
    volunteerPortfolioLabel,
  );
  const hasVolunteering =
    volunteeringLabels.length > 0 || Boolean(pf.volunteeringOther);
  const hasRanger =
    pf.rangerTraining || pf.rangerCurious || pf.greenDotTraining;
  const hasCamps = profile.camps.length > 0 || profile.campHistory.length > 0;

  return (
    <>
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <ProfileHero
          displayName={heading}
          homeCity={pf.homeCity}
          burnsCount={
            pf.attendedYears.length > 0 ? pf.attendedYears.length : null
          }
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

        {medical.visible && medical.notes && (
          <ProfileSection
            label="Medical notes"
            icon={
              <Stethoscope className="h-3.5 w-3.5 text-accent" aria-hidden />
            }
          >
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed">
              {medical.notes}
            </p>
            <p className="text-xs text-muted-foreground">
              {isOwn
                ? "Only your camp leads and AfrikaBurn's safety team can see this."
                : "Shared with you as a camp lead / AfrikaBurn safety staff. Never public, and this view is logged."}
            </p>
          </ProfileSection>
        )}

        {/* Ciphertext on file that this deployment cannot decrypt. Showing
            nothing would read as "no medical notes", which on a safety surface
            is a false all-clear — so say plainly that something exists and
            cannot be read. */}
        {medical.visible && medical.unreadable && (
          <ProfileSection
            label="Medical notes"
            icon={
              <Stethoscope className="h-3.5 w-3.5 text-accent" aria-hidden />
            }
          >
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm leading-relaxed"
            >
              <strong className="font-medium">
                There are medical notes on file that cannot be read.
              </strong>{" "}
              {isOwn
                ? "Your notes were saved with a different encryption key than this site is using. Re-save them from your profile, and tell an organiser."
                : "This is a configuration fault, not an empty field — do not read it as “no medical notes”. Ask an organiser to check the encryption key, and ask the burner directly if you need this now."}
            </p>
          </ProfileSection>
        )}

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
            icon={
              <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
            }
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
    </>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, Lock, Pencil, ShieldCheck, Tent } from "lucide-react";
import {
  initialsFromName,
  mapBioToResponses,
  type BioExtras,
  type BurnerBioFields,
} from "@quagga/core";
import { volunteerPortfolioLabel } from "@quagga/types";
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
import { ensureCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getBio, getKeyFingerprint } from "@/lib/bio-store";
import { describeSignInMethods, listLinkedAccounts } from "@/lib/account";
import { resolveCampHistoryDisplay } from "@/lib/groups-store";
import { searchCampsAction } from "@/lib/camp-search-action";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BioFlow } from "@/components/onboarding/bio-flow";
import { SignOutButton } from "@/components/sign-out-button";
import { toBioExtrasState } from "@/components/questionnaire/extras-state";
import { updateBioAction } from "./actions";

export const dynamic = "force-dynamic";

type Visibility = "public" | "private" | "locked";

function PrivacyBadge({ visibility }: { visibility: Visibility }) {
  if (visibility === "locked") {
    return (
      <Badge variant="outline" className="shrink-0 gap-1">
        <Lock className="h-3 w-3" aria-hidden />
        Always private
      </Badge>
    );
  }
  if (visibility === "public") {
    return (
      <Badge variant="success" className="shrink-0">
        Public
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0">
      Private
    </Badge>
  );
}

function BioRow({
  label,
  value,
  visibility,
  children,
}: {
  label: string;
  value?: string | null;
  visibility: Visibility;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {children ?? (
          <p className="mt-0.5 truncate text-sm text-foreground">
            {value?.trim() ? value : <span className="text-muted-foreground">Not set</span>}
          </p>
        )}
      </div>
      <PrivacyBadge visibility={visibility} />
    </div>
  );
}

function vis(flags: Record<string, boolean>, key: string): Visibility {
  return flags[key] === true ? "public" : "private";
}

function contactSummary(
  name: string | null,
  phone: string | null,
): string | null {
  const parts = [name?.trim(), phone?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Your profile" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  const edition = user ? await getActiveEdition() : null;
  if (!user || !edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Your profile" />
      </AppShell>
    );
  }

  // Hard gate: a pending blocking questionnaire keeps the profile out of reach
  // until it's done (the Burner Bio redirect below covers the onboarding case).
  await enforceGate(user.id);

  const bio = await getBio(user.id, edition.id);
  if (!bio?.completedAt) redirect("/onboarding");

  const { edit } = await searchParams;
  const editing = edit === "1";

  if (editing) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">
              Edit your bio
            </h1>
            <Button asChild variant="ghost" size="sm">
              <Link href="/profile">Cancel</Link>
            </Button>
          </div>
          <BioFlow
            mode="edit"
            initialResponses={mapBioToResponses(bio.fields)}
            initialFlags={bio.privacyFlags}
            initialExtras={toBioExtrasState(bio.extras)}
            action={updateBioAction}
            searchCamps={searchCampsAction}
            redirectTo="/profile"
          />
        </div>
      </AppShell>
    );
  }

  const fields: BurnerBioFields = bio.fields;
  const extras: BioExtras = bio.extras;
  const flags = bio.privacyFlags;
  const fingerprint = await getKeyFingerprint(user.id);
  const signInMethods = describeSignInMethods(await listLinkedAccounts());
  const campHistory = await resolveCampHistoryDisplay(
    extras.campHistory,
    edition.id,
  );
  const volunteeringLabels = extras.volunteeringInterests.map(
    volunteerPortfolioLabel,
  );
  const hasRanger =
    extras.rangerTraining || extras.rangerCurious || extras.greenDotTraining;
  const hasBurns =
    Boolean(extras.about) ||
    campHistory.length > 0 ||
    volunteeringLabels.length > 0 ||
    Boolean(extras.volunteeringOther) ||
    hasRanger;

  const onsite = contactSummary(fields.onsiteContactName, fields.onsiteContactPhone);
  const offsite = contactSummary(
    fields.offsiteContactName,
    fields.offsiteContactPhone,
  );

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you carry year to year. Locked fields are held privately
            and never appear in the directory or to other camps.
          </p>
        </div>

        {/* Identity ------------------------------------------------------- */}
        <div className="flex items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary"
            aria-hidden
          >
            {initialsFromName(fields.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold tracking-tight">
              {fields.displayName ?? "Unnamed burner"}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {fields.homeCity ?? "Home city not set"}
            </p>
          </div>
        </div>

        {/* Bio Card ------------------------------------------------------- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Bio</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href="/profile?edit=1">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit bio
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col divide-y divide-border">
              <BioRow
                label="Burner name"
                value={fields.displayName}
                visibility={vis(flags, "displayName")}
              />
              <BioRow
                label="Real name"
                value={fields.legalName}
                visibility={vis(flags, "legalName")}
              />
              <BioRow
                label="Home city"
                value={fields.homeCity}
                visibility={vis(flags, "homeCity")}
              />
              <BioRow label="Years attended" visibility={vis(flags, "attendedYears")}>
                {fields.attendedYears.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {fields.attendedYears.map((year) => (
                      <span
                        key={year}
                        className="rounded-md border border-border px-2 py-0.5 text-xs tabular-nums text-foreground"
                      >
                        {year}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    First AfrikaBurn
                  </p>
                )}
              </BioRow>
              <BioRow
                label="Phone"
                value={fields.phone}
                visibility="locked"
              />
              <BioRow
                label="On-site emergency contact"
                value={onsite}
                visibility="locked"
              />
              <BioRow
                label="Off-site emergency contact"
                value={offsite}
                visibility="locked"
              />
            </div>
          </CardContent>
        </Card>

        {/* Burns & volunteering ------------------------------------------ */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Burns &amp; volunteering</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href="/profile?edit=1">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!hasBurns && (
              <p className="text-sm text-muted-foreground">
                Nothing added yet — use Edit to tell other burners who you are in
                the dust.
              </p>
            )}

            {extras.about && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  About
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {extras.about}
                </p>
              </div>
            )}

            {campHistory.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  Camps you&apos;ve been part of
                </p>
                <ul className="flex flex-col divide-y divide-border">
                  {campHistory.map((entry, i) => (
                    <li
                      key={`${entry.label}-${i}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {entry.kind === "linked" && entry.slug ? (
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
                      {entry.kind === "linked" ? (
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          <Tent className="h-3 w-3" aria-hidden />
                          Linked
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(volunteeringLabels.length > 0 || extras.volunteeringOther) && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  Volunteering interests
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {volunteeringLabels.map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                  {extras.volunteeringOther && (
                    <Badge variant="outline">{extras.volunteeringOther}</Badge>
                  )}
                </div>
              </div>
            )}

            {hasRanger && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
                  Rangers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {extras.rangerTraining && (
                    <Badge variant="success">Dust Ranger trained</Badge>
                  )}
                  {extras.rangerCurious && (
                    <Badge variant="secondary">Curious about shifts</Badge>
                  )}
                  {extras.greenDotTraining && (
                    <Badge variant="success">Green Dot trained</Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security ------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-accent" aria-hidden />
              Security
            </CardTitle>
            <CardDescription>
              Your signing key — a keypair generated for you at sign-up, held for
              future on-site QR attestations. You never manage it directly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Signing key
            </p>
            <p className="mt-1 font-mono text-sm">
              {fingerprint ?? "Generating on next save…"}
            </p>
          </CardContent>
        </Card>

        {/* Account ------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col divide-y divide-border">
              <div className="flex items-center justify-between gap-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <p className="truncate text-sm text-foreground">
                  {user.email ?? authUser.primaryEmail ?? "—"}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Sign-in
                </p>
                <p className="text-sm text-foreground">
                  {signInMethods ?? "Not available"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sign out ------------------------------------------------------ */}
        <div className="flex justify-end border-t border-border pt-4">
          <SignOutButton />
        </div>
      </div>
    </AppShell>
  );
}

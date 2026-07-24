import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, Pencil } from "lucide-react";
import {
  BIO_PRIVACY_FIELDS,
  buildBurnerBioQuestionnaire,
  type BurnerBioFields,
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
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getBio, getKeyFingerprint } from "@/lib/bio-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { PrivacyForm } from "@/components/privacy-form";
import { QuestionnaireRunner } from "@/components/questionnaire/runner";
import { savePrivacyFlagsAction, updateBioAction } from "./actions";

export const dynamic = "force-dynamic";

function displayValue(fields: BurnerBioFields, key: string): string | null {
  switch (key) {
    case "displayName":
      return fields.displayName;
    case "legalName":
      return fields.legalName;
    case "homeCity":
      return fields.homeCity;
    case "bio":
      return fields.bio;
    case "skills":
      return fields.skills.length ? fields.skills.join(", ") : null;
    case "attendedYears":
      return fields.attendedYears.length
        ? fields.attendedYears.join(", ")
        : fields.firstTime
          ? "First AfrikaBurn"
          : null;
    case "firstTime":
      return fields.firstTime ? "Yes" : "No";
    case "contactEmail":
      return fields.contactEmail;
    default:
      return null;
  }
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

  const fingerprint = await getKeyFingerprint(user.id);
  const { edit } = await searchParams;
  const editing = edit === "1";

  if (editing) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">
              Edit your bio
            </h1>
            <Button asChild variant="ghost" size="sm">
              <Link href="/profile">Cancel</Link>
            </Button>
          </div>
          <QuestionnaireRunner
            questionnaire={buildBurnerBioQuestionnaire()}
            initialResponses={bio.responses}
            action={updateBioAction}
            submitLabel="Save changes"
            redirectTo="/profile"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Burner Bio
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {bio.fields.displayName}
            </h1>
            {bio.fields.homeCity && (
              <p className="mt-1 text-sm text-muted-foreground">
                {bio.fields.homeCity}
              </p>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile?edit=1">
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Link>
          </Button>
        </div>

        {bio.fields.bio && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {bio.fields.bio}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
            <CardDescription>
              What each field shows to others. Locked fields are always private.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col divide-y divide-border">
              {BIO_PRIVACY_FIELDS.map((field) => {
                const value = field.locked
                  ? null
                  : displayValue(bio.fields, field.key);
                const isPublic = !field.locked && bio.privacyFlags[field.key];
                return (
                  <div
                    key={field.key}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <dt className="text-sm font-medium">{field.label}</dt>
                      <dd className="truncate text-sm text-muted-foreground">
                        {field.locked
                          ? "Held privately"
                          : (value ?? "Not set")}
                      </dd>
                    </div>
                    <Badge variant={field.locked ? "outline" : isPublic ? "success" : "secondary"}>
                      {field.locked ? "Locked" : isPublic ? "Public" : "Private"}
                    </Badge>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Privacy</CardTitle>
            <CardDescription>
              Toggle what appears on your public profile. Sensitive fields can
              never be made public.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PrivacyForm
              fields={BIO_PRIVACY_FIELDS}
              initialFlags={bio.privacyFlags}
              action={savePrivacyFlagsAction}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-accent" aria-hidden />
              Profile key
            </CardTitle>
            <CardDescription>
              A keypair generated for you at sign-up, held for future on-site QR
              attestations. You never manage it directly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Fingerprint</p>
            <p className="mt-1 font-mono text-sm">
              {fingerprint ?? "Generating on next save…"}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

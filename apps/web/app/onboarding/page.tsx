import { redirect } from "next/navigation";
import { defaultPrivacyFlags, mapBioToResponses } from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getBio } from "@/lib/bio-store";
import { searchCampsAction } from "@/lib/camp-search-action";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BioFlow } from "@/components/onboarding/bio-flow";
import { toBioExtrasState } from "@/components/questionnaire/extras-state";
import { saveOnboardingBioAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Burner Bio onboarding" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  const edition = user ? await getActiveEdition() : null;
  if (!user || !edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Burner Bio onboarding" />
      </AppShell>
    );
  }

  const bio = await getBio(user.id, edition.id);
  if (bio?.completedAt) redirect("/profile");

  // Pre-fill from any in-progress bio so "save & finish later" resumes cleanly.
  const initialResponses = bio
    ? mapBioToResponses(bio.fields)
    : {};
  const initialFlags = bio?.privacyFlags ?? defaultPrivacyFlags();

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set up your Burner Bio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A few minutes now, then everything else opens up. You can edit any of
            this later from your profile.
          </p>
        </div>
        <BioFlow
          mode="onboarding"
          initialResponses={initialResponses}
          initialFlags={initialFlags}
          initialExtras={toBioExtrasState(bio?.extras)}
          action={saveOnboardingBioAction}
          searchCamps={searchCampsAction}
          redirectTo="/directory"
        />
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import {
  BIO_PRIVACY_FIELDS,
  buildBurnerBioQuestionnaire,
  defaultPrivacyFlags,
} from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getBio } from "@/lib/bio-store";
import { searchCampsAction } from "@/lib/camp-search-action";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { QuestionnaireRunner } from "@/components/questionnaire/runner";
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

  const questionnaire = buildBurnerBioQuestionnaire();
  const initialResponses = bio?.responses ?? {};
  const initialFlags = bio?.privacyFlags ?? defaultPrivacyFlags();

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Welcome
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Set up your Burner Bio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A few minutes now, then everything else opens up. You can edit any of
            this later from your profile.
          </p>
        </div>
        <QuestionnaireRunner
          questionnaire={questionnaire}
          initialResponses={initialResponses}
          action={saveOnboardingBioAction}
          burns={{
            initial: toBioExtrasState(bio?.extras),
            searchCamps: searchCampsAction,
          }}
          privacy={{ fields: BIO_PRIVACY_FIELDS, initialFlags }}
          submitLabel="Complete my bio"
          redirectTo="/directory"
        />
      </div>
    </AppShell>
  );
}

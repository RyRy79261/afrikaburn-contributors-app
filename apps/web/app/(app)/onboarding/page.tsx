import { redirect } from "next/navigation";
import {
  INVITE_RESUME_PATH,
  defaultPrivacyFlags,
  mapBioToResponses,
} from "@quagga/core";
import { readPendingInvite } from "@/lib/pending-invite";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getBio } from "@/lib/bio-store";
import { searchCampsAction } from "@/lib/camp-search-action";
import { PreviewNotice } from "@/components/preview-notice";
import { BioFlow } from "@/components/onboarding/bio-flow";
import { toBioExtrasState } from "@/components/questionnaire/extras-state";
import {
  checkUsernameAvailabilityAction,
  saveOnboardingBioAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Burner Bio onboarding" />;
  }

  const user = await ensureCampUser(authUser);
  const edition = user ? await getActiveEdition() : null;
  if (!user || !edition) {
    return <PreviewNotice feature="Burner Bio onboarding" />;
  }

  const bio = await getBio(user.id, edition.id);
  // A COMPLETED BIO LEAVES — BUT ONLY IF THE GATE ACTUALLY OPENED.
  //
  // `/profile` is gated: `enforceGate` sends anyone with a pending blocking
  // action back to `/onboarding`. So an unconditional bounce here trusts that
  // `completed_at` and the required action can never disagree. When they do,
  // this line and that one redirect at each other for ever, and the burner
  // cannot reach any page of the app — including this one, the only page that
  // could fix it.
  //
  // `saveBio` now writes both halves in one transaction so they cannot come
  // apart, and this is the second lock on the same door: rows written before
  // that fix, or by any future path that stamps completion without clearing the
  // gate, land on the flow instead of in a loop. The final step re-saves and
  // clears the action, so the way out is the way through.
  if (bio?.completedAt && (await pendingBlockingRoute(user.id)) === null) {
    redirect("/profile");
  }

  // Pre-fill from any in-progress bio so "save & finish later" resumes cleanly.
  // The username lives on `users`, not the bio row, so it is threaded in.
  const initialResponses = bio
    ? mapBioToResponses(bio.fields, bio.username)
    : {};
  const initialFlags = bio?.privacyFlags ?? defaultPrivacyFlags();

  // Someone who arrived via an invite is only here because the Burner Bio gates
  // the join. Finish the bio and the invite completes itself — they land on
  // their camp instead of a generic page, having lost the link they clicked.
  const redirectTo = (await readPendingInvite())
    ? INVITE_RESUME_PATH
    : "/directory";

  return (
    <>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set up your Burner Bio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A few minutes now, then everything else opens up. You can edit any
            of this later from your profile.
          </p>
        </div>
        <BioFlow
          mode="onboarding"
          initialResponses={initialResponses}
          initialFlags={initialFlags}
          initialExtras={toBioExtrasState(bio?.extras)}
          action={saveOnboardingBioAction}
          searchCamps={searchCampsAction}
          checkUsername={checkUsernameAvailabilityAction}
          redirectTo={redirectTo}
        />
      </div>
    </>
  );
}

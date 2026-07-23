import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser } from "@/lib/session";
import { listRequiredActions } from "@/lib/required-actions";
import { firstBlockingAction } from "@quagga/core";
import { isDatabaseConfigured } from "@/lib/config";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { CreateCampForm } from "@/components/create-camp-form";
import { createCampAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewCampPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Creating a camp" />
      </AppShell>
    );
  }

  const user = await ensureCampUser(authUser);
  if (!user) {
    return (
      <AppShell>
        <PreviewNotice feature="Creating a camp" />
      </AppShell>
    );
  }
  // Onboarding gates everything else.
  const actions = await listRequiredActions(user.id);
  if (firstBlockingAction(actions)) redirect("/onboarding");

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <header className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create a camp
          </h1>
          <p className="text-sm text-muted-foreground">
            It exists the moment you create it — a free camp you can invite
            people to and organise right away. Registration comes later and earns
            entitlements.
          </p>
        </header>
        <CreateCampForm action={createCampAction} />
      </div>
    </AppShell>
  );
}

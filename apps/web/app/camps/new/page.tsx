import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureCampUser, pendingBlockingRoute } from "@/lib/session";
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
  // Onboarding (and any blocking questionnaire) gates everything else.
  const gate = await pendingBlockingRoute(user.id);
  if (gate) redirect(gate);

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <Link
          href="/directory"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to directory
        </Link>
        <header className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create a camp
          </h1>
          <p className="text-sm text-muted-foreground">
            Fewer forms, not more. Your camp exists the moment you create it —
            invite your people right away. Registration for entitlements comes
            later, when you&rsquo;re ready.
          </p>
        </header>
        <CreateCampForm action={createCampAction} />
      </div>
    </AppShell>
  );
}

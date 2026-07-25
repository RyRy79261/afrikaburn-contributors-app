import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import { getEditionLabel } from "@/lib/edition";
import { AuthShell } from "@/components/auth/auth-shell";
import { SupplierSignInForm } from "@/components/auth/sign-in-form";

// /signin — the supplier portal's sign-in screen (canvas `OX6KJ` desktop,
// `xgCd7` mobile). Static route, same reasoning as /signup.

export const dynamic = "force-dynamic";

export default async function SupplierSignInPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/onboarding");

  const editionLabel = await getEditionLabel();

  return (
    <AuthShell editionLabel={editionLabel}>
      <SupplierSignInForm />
    </AuthShell>
  );
}

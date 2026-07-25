import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import { getEditionLabel } from "@/lib/edition";
import { AuthShell } from "@/components/auth/auth-shell";
import { SupplierSignUpForm } from "@/components/auth/sign-up-form";

// /signup — the supplier portal's registration screen (canvas `K3zNk` desktop,
// `h83pUG` mobile). A STATIC route so it wins over the `/auth/[...path]`
// catch-all that hands unknown auth subpaths to the stock Neon Auth views: this
// screen is ours, branded sage, and enumeration-safe in our own words.
//
// Reads the session cookie, so it cannot be statically prerendered.

export const dynamic = "force-dynamic";

export default async function SupplierSignUpPage() {
  // Already signed in? There is nothing to create — go to the portal, which
  // gates properly (and offers the register form if no supplier row matched).
  const user = await getAuthenticatedUser();
  if (user) redirect("/onboarding");

  const editionLabel = await getEditionLabel();

  return (
    <AuthShell editionLabel={editionLabel}>
      <SupplierSignUpForm />
    </AuthShell>
  );
}

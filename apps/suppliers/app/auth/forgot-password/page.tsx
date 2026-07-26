import { getEditionLabel } from "@/lib/edition";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

// /auth/forgot-password — a STATIC route that wins over the `/auth/[...path]`
// catch-all, so the portal's recovery screen is branded sage and
// enumeration-safe in our own words.
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const editionLabel = await getEditionLabel();
  return (
    <AuthShell editionLabel={editionLabel}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}

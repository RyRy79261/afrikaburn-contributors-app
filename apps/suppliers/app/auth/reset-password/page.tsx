import { getEditionLabel } from "@/lib/edition";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// /auth/reset-password?token=… — the token arrives in the emailed link's query
// string. `?error=` is possible when the token is rejected before redirecting,
// so a missing token and an error are treated the same: an honest dead-end plus
// a way to request a fresh link. STATIC route, wins over the `[...path]`
// catch-all.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const usableToken = error ? null : (token?.trim() || null);
  const editionLabel = await getEditionLabel();

  return (
    <AuthShell editionLabel={editionLabel}>
      <ResetPasswordForm token={usableToken} />
    </AuthShell>
  );
}

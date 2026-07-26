import { redirect } from "next/navigation";

// Auth subpath router for the portal. Sign-in and sign-up are OURS (canvas
// `OX6KJ` / `K3zNk`) at /signin and /signup; forgot- and reset-password are
// their own STATIC routes (app/auth/forgot-password + reset-password) that win
// over this catch-all. Verification and OAuth callbacks are handled by the route
// handler (self-hosted @quagga/auth at /api/auth/*), not a page — so any
// remaining auth subpath simply redirects to sign-in rather than rendering a
// stock view.
export const dynamic = "force-dynamic";

const BRANDED_REDIRECTS: Record<string, string> = {
  "sign-in": "/signin",
  signin: "/signin",
  "sign-up": "/signup",
  signup: "/signup",
};

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const view = path?.[0] ?? "sign-in";
  redirect(BRANDED_REDIRECTS[view] ?? "/signin");
}

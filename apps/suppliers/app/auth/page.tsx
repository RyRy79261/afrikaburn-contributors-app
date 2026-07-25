import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";

// Bare /auth landing — where Neon Auth's social callback returns after OAuth.
// Reads the freshly-set session cookie, so cannot be statically prerendered.
export const dynamic = "force-dynamic";

export default async function AuthRootPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/");
  redirect("/signin");
}

import "server-only";

import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { enforceGate, getCurrentCampUser, type CampUser } from "@/lib/session";

// The shared guard for /camps/[slug]/teams pages (docs/camp-teams-spec.md):
// signed in and past the hard gate. WHETHER the viewer may see the camp's
// teams is the store's call (`listCampTeams` / `getCampTeam` return null for
// anyone who is not a current member), which each page turns into the
// camp's ordinary 404.

export type TeamsContext =
  { kind: "preview" } | { kind: "ready"; user: CampUser; edition: Edition };

/** Signed in and past the hard gate, or the preview notice without a
 * database or an edition. */
export async function loadTeamsContext(): Promise<TeamsContext> {
  if (!isDatabaseConfigured()) return { kind: "preview" };
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const [user, edition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!user) redirect("/auth/sign-in");
  if (!edition) return { kind: "preview" };
  await enforceGate(user.id);
  return { kind: "ready", user, edition };
}

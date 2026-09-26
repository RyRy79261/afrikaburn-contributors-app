import "server-only";

import { notFound, redirect } from "next/navigation";
import { canViewCampRegistration } from "@quagga/core";
import { getAuthenticatedUser } from "./auth";
import { getCurrentCampUser, enforceGate } from "./session";
import { isDatabaseConfigured } from "./config";
import { getActiveEdition } from "./edition";
import {
  getRegistrationCampContext,
  type RegistrationCampContext,
} from "./registration-store";

// THE DOOR to the registration's read-only companions — "Past registrations"
// and "What changed" (epic #50). The same steps, in the same order, as the
// registration workspace itself, so no one reaches the history of a
// registration they could not open:
//
//   signed in → a camp user → no blocking questionnaire pending → an active
//   edition → the camp exists → `canViewCampRegistration(role)`.
//
// The role check is @quagga/core's, enforced here on the server; the links that
// lead to these pages are hidden from everyone else too, but hiding them is not
// what keeps anyone out.

export type RegistrationViewer =
  | { configured: false }
  | {
      configured: true;
      campUserId: string;
      context: RegistrationCampContext;
    };

export async function requireRegistrationViewer(
  slug: string,
): Promise<RegistrationViewer> {
  if (!isDatabaseConfigured()) return { configured: false };

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await getCurrentCampUser();
  if (!campUser) redirect("/auth/sign-in");
  await enforceGate(campUser.id);

  const edition = await getActiveEdition();
  if (!edition) return { configured: false };

  const context = await getRegistrationCampContext(slug, campUser.id, edition);
  if (!context) notFound();

  if (!canViewCampRegistration(context.role)) redirect(`/camps/${slug}`);

  return { configured: true, campUserId: campUser.id, context };
}

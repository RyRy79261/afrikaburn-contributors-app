import "server-only";

import { revalidatePath } from "next/cache";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { requireCampUser } from "./session";
import { getActiveEdition } from "./edition";
import {
  carryForwardProjectRegistration,
  getProjectRegistrationForEdit,
  type ProjectCarryForwardResult,
  type ProjectRegistrationKind,
} from "./project-registration-store";

// The server half of "bring last year's answers across" for a mutant vehicle or
// an artwork (CREATIVE-019). The two kind-specific "use server" actions are thin
// wrappers over this, so the authz lives in one place:
//
//   · signed in (requireCampUser — onboarding-gated like every write);
//   · the slug is a group of THIS kind (a vehicle slug on the artwork action is
//     not found, not carried forward under the wrong key);
//   · the caller is that project's STRUCTURAL lead/admin — the same gate as the
//     edit action, because carrying forward is an edit.
//
// What carries is @quagga/core's decision; this only checks who is asking.

const KIND_PATH: Record<ProjectRegistrationKind, string> = {
  artwork: "artworks",
  mutant_vehicle: "vehicles",
};

export async function runProjectCarryForward(
  slug: string,
  kind: ProjectRegistrationKind,
): Promise<ProjectCarryForwardResult> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) {
    return {
      ok: false,
      error: "No AfrikaBurn edition is open for registration yet.",
    };
  }

  const ctx = await getProjectRegistrationForEdit(
    slug,
    kind,
    user.id,
    edition.id,
  );
  if (!ctx) return { ok: false, error: "That project no longer exists." };
  if (!ctx.role || !PROJECT_ADMIN_ROLES.includes(ctx.role)) {
    return {
      ok: false,
      error: "Only a project lead can bring last year's answers across.",
    };
  }

  const result = await carryForwardProjectRegistration({
    groupId: ctx.group.id,
    kind,
    editionId: edition.id,
    editionYear: edition.year,
    editionEndDate: edition.endDate,
    editorUserId: user.id,
    editorEmail: user.email,
  });
  if (result.ok) {
    revalidatePath(`/${KIND_PATH[kind]}/${slug}/edit`);
    revalidatePath(`/camps/${slug}`);
  }
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  canAuthorOnboarding,
  defaultOnboardingAudience,
  validateOnboardingDefinition,
} from "@quagga/core";
import {
  CampTenure,
  ProjectStructuralRole,
  Questionnaire,
  type ProjectAudience,
} from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { db, schema } from "@/lib/db";
import {
  getBaselineRoleId,
  getMemberPermissions,
  listRoles,
} from "@/lib/roles-store";
import {
  createOnboardingDraft,
  discardOnboardingDraft,
  getOnboardingDraft,
  insertOnboardingDraft,
  listOnboardingsForEdition,
  prepareOnboardingCarry,
  saveOnboardingDraft,
  sendOnboardingDraft,
} from "@/lib/onboarding-store";

// Camp onboarding actions (epic #54). Every one of them:
//   1. parses its input with Zod — nothing from the client is trusted as-is;
//   2. resolves the camp from the SLUG, never from a client-supplied group id,
//      so the audience it writes is always anchored on the camp in the URL;
//   3. authorises through @quagga/core `canAuthorOnboarding` against the
//      audience + blocking choice actually being written (and, for an
//      existing draft, the one already stored — you may only touch a draft
//      you could have written).

const Slug = z.string().min(1).max(200);

/** The camp for a slug, theme camps only (the org group never resolves). */
async function campForSlug(
  slug: string,
): Promise<{ id: string; kind: string; name: string } | null> {
  const [row] = await db()
    .select({
      id: schema.groups.id,
      kind: schema.groups.kind,
      name: schema.groups.name,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!row || row.kind !== "theme_camp") return null;
  return row;
}

async function authorContext(groupId: string, userId: string) {
  const [perms, baselineRoleId] = await Promise.all([
    getMemberPermissions(groupId, userId),
    getBaselineRoleId(groupId),
  ]);
  return { perms, baselineRoleId };
}

function questionnairesPath(slug: string): string {
  return `/camps/${slug}/questionnaires`;
}

export type OnboardingActionResult =
  | { ok: true; activationId: string }
  | { ok: false; error: string };

const NOT_ALLOWED =
  "You can't write an onboarding for this camp — ask a lead or co-lead.";

/** The refusal for someone who may not author: a NON-member gets exactly the
 * unknown-slug answer, so the actions can't be used to learn that a camp (free
 * camps are undiscoverable) exists. A member already knows. */
function refusalFor(perms: unknown): string {
  return perms ? NOT_ALLOWED : "Camp not found.";
}

// --- Start from the preset -------------------------------------------------

const StartInput = z.object({ slug: Slug });

/** A1 → A2: create a draft from the onboarding preset. Sends nothing. */
export async function startOnboardingAction(
  raw: unknown,
): Promise<OnboardingActionResult> {
  const parsed = StartInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Camp not found." };
  const user = await requireCampUser();
  const camp = await campForSlug(parsed.data.slug);
  if (!camp) return { ok: false, error: "Camp not found." };
  const { perms, baselineRoleId } = await authorContext(camp.id, user.id);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      defaultOnboardingAudience(camp.id),
      false,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  const activationId = await createOnboardingDraft({
    groupId: camp.id,
    editionId: edition.id,
    createdByUserId: user.id,
    campName: camp.name,
  });
  revalidatePath(questionnairesPath(parsed.data.slug));
  return { ok: true, activationId };
}

// --- Autosave --------------------------------------------------------------

const AudienceInput = z.object({
  mode: z.enum(["everyone", "roles"]),
  roleIds: z.array(z.string().uuid()).max(50),
  tenure: z.array(CampTenure).min(1).max(2),
  structuralRoles: z.array(ProjectStructuralRole).min(1).max(3),
});

const SaveInput = z.object({
  slug: Slug,
  activationId: z.string().uuid(),
  title: z.string().trim().min(1).max(140),
  definition: Questionnaire,
  audience: AudienceInput,
  blocking: z.boolean(),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    // A real calendar day: "2027-02-31" must not roll over to 3 March, and
    // "2027-13-01" must not reach the database as an Invalid Date.
    .refine(
      (d) => {
        const t = Date.parse(`${d}T00:00:00.000Z`);
        return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
      },
      "That date doesn't exist.",
    )
    .nullable(),
});

/** Turn the client's audience choice into a stored spec anchored on THIS camp,
 * dropping any role id that isn't one of this camp's roles. */
async function anchorAudience(
  groupId: string,
  input: z.infer<typeof AudienceInput>,
): Promise<ProjectAudience | null> {
  const roles = await listRoles(groupId);
  const own = new Set(
    roles.filter((r) => r.kind !== "baseline").map((r) => r.id),
  );
  const roleIds = [...new Set(input.roleIds)].filter((id) => own.has(id));
  if (input.mode === "roles" && roleIds.length === 0) return null;
  return {
    kind: "project",
    groupId,
    mode: input.mode,
    roleIds: input.mode === "roles" ? roleIds : [],
    tenure: [...new Set(input.tenure)],
    structuralRoles: [...new Set(input.structuralRoles)],
  };
}

export type SaveOnboardingResult =
  { ok: true } | { ok: false; error: string; sent?: boolean };

export async function saveOnboardingDraftAction(
  raw: unknown,
): Promise<SaveOnboardingResult> {
  const parsed = SaveInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Some of this onboarding isn't filled in yet." };
  }
  const input = parsed.data;
  const user = await requireCampUser();
  const camp = await campForSlug(input.slug);
  if (!camp) return { ok: false, error: "Camp not found." };

  const draft = await getOnboardingDraft(input.activationId, camp.id);
  if (!draft || draft.audience?.kind !== "project") {
    return {
      ok: false,
      error: "This onboarding has already been sent — it can't be edited.",
      sent: true,
    };
  }
  const audience = await anchorAudience(camp.id, input.audience);
  if (!audience) {
    return { ok: false, error: "Pick at least one camp role to narrow to." };
  }
  const { perms, baselineRoleId } = await authorContext(camp.id, user.id);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      draft.audience,
      draft.blocking,
      baselineRoleId,
    ) ||
    !canAuthorOnboarding(
      perms,
      camp.kind,
      audience,
      input.blocking,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const valid = validateOnboardingDefinition(input.definition);
  if (!valid.ok) return { ok: false, error: valid.error };

  const result = await saveOnboardingDraft({
    activationId: input.activationId,
    groupId: camp.id,
    title: input.title,
    description: null,
    definition: valid.definition,
    audience,
    blocking: input.blocking,
    dueAt: input.dueAt ? new Date(`${input.dueAt}T00:00:00.000Z`) : null,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      sent: result.reason === "not_draft",
    };
  }
  return { ok: true };
}

// --- Send --------------------------------------------------------------------

const DraftRef = z.object({ slug: Slug, activationId: z.string().uuid() });

export type SendOnboardingResult =
  | { ok: true; activationId: string; sent: number; emailDelivered: boolean }
  | { ok: false; error: string };

/** Send the STORED draft — the client saves first; what goes out is what the
 * server holds, re-validated. */
export async function sendOnboardingAction(
  raw: unknown,
): Promise<SendOnboardingResult> {
  const parsed = DraftRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Onboarding not found." };
  const user = await requireCampUser();
  const camp = await campForSlug(parsed.data.slug);
  if (!camp) return { ok: false, error: "Camp not found." };
  const draft = await getOnboardingDraft(parsed.data.activationId, camp.id);
  if (!draft || draft.audience?.kind !== "project") {
    return { ok: false, error: "This onboarding has already been sent." };
  }
  const { perms, baselineRoleId } = await authorContext(camp.id, user.id);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      draft.audience,
      draft.blocking,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  const result = await sendOnboardingDraft({
    draft,
    groupId: camp.id,
    activeEditionId: edition.id,
    senderUserId: user.id,
  });
  revalidatePath(questionnairesPath(parsed.data.slug));
  if (!result.ok) return result;
  return {
    ok: true,
    activationId: parsed.data.activationId,
    sent: result.sent,
    emailDelivered: result.emailDelivered,
  };
}

// --- Discard a draft -----------------------------------------------------------

export async function discardOnboardingDraftAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = DraftRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Onboarding not found." };
  const user = await requireCampUser();
  const camp = await campForSlug(parsed.data.slug);
  if (!camp) return { ok: false, error: "Camp not found." };
  const draft = await getOnboardingDraft(parsed.data.activationId, camp.id);
  if (!draft || draft.audience?.kind !== "project") {
    return { ok: false, error: "Only an unsent draft can be discarded." };
  }
  const { perms, baselineRoleId } = await authorContext(camp.id, user.id);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      draft.audience,
      draft.blocking,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const gone = await discardOnboardingDraft(parsed.data.activationId, camp.id);
  revalidatePath(questionnairesPath(parsed.data.slug));
  return gone
    ? { ok: true }
    : { ok: false, error: "Only an unsent draft can be discarded." };
}

// --- Carry forward (ONBOARD-022) ---------------------------------------------

const CarryInput = z.object({
  slug: Slug,
  sourceActivationId: z.string().uuid(),
});

export async function carryForwardOnboardingAction(
  raw: unknown,
): Promise<OnboardingActionResult> {
  const parsed = CarryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Onboarding not found." };
  const user = await requireCampUser();
  const camp = await campForSlug(parsed.data.slug);
  if (!camp) return { ok: false, error: "Camp not found." };
  // Permission FIRST, so the source lookup below answers nobody who may not
  // author an onboarding here (its "no earlier onboarding" reply is otherwise
  // a probe of the camp's history).
  const { perms, baselineRoleId } = await authorContext(camp.id, user.id);
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      defaultOnboardingAudience(camp.id),
      false,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  // One carried draft per edition: a double-click or a second tab must not
  // make two.
  if ((await listOnboardingsForEdition(camp.id, edition.id)).length > 0) {
    return {
      ok: false,
      error: "This edition already has an onboarding — open it from the list.",
    };
  }
  const prepared = await prepareOnboardingCarry({
    sourceActivationId: parsed.data.sourceActivationId,
    groupId: camp.id,
    activeEditionId: edition.id,
    activeEditionYear: edition.year,
    userId: user.id,
  });
  if (!prepared.ok) return prepared;
  // The carried draft keeps last year's audience and blocking choice; the same
  // predicate that will guard editing and sending it guards creating it.
  if (
    !canAuthorOnboarding(
      perms,
      camp.kind,
      prepared.draft.audience,
      prepared.draft.blocking,
      baselineRoleId,
    )
  ) {
    return { ok: false, error: refusalFor(perms) };
  }
  const activationId = await insertOnboardingDraft(prepared.draft);
  revalidatePath(questionnairesPath(parsed.data.slug));
  return { ok: true, activationId };
}

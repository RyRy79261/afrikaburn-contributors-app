"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { OperatingHours, PROJECT_ADMIN_ROLES } from "@quagga/types";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { db, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import {
  applyCampAction,
  getRegistration,
  saveRegistrationDraft,
  type RegistrationValues,
  type SaveDraftResult,
  type TransitionResult,
} from "@/lib/registration-store";

// Server actions for the six-section registration wizard (build-spec §apps/web
// `/camps/[slug]/registration`). Every write is gated on a lead/admin
// membership; Zod validates the value payload at the boundary. Transitions run
// through @quagga/core's state machine + submit gate via the store.

/** Nullable trimmed string that treats "" as null (empty ⇒ not answered). */
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => {
      const t = s.trim();
      return t.length === 0 ? null : t;
    })
    .nullish()
    .transform((v) => v ?? null);

const nullableInt = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

const RegistrationValuesSchema = z.object({
  campDescription: nullableText(4000),
  s1ContactEmail: nullableText(200),
  s1AltContactName: nullableText(200),
  s1AltContactPhone: nullableText(60),
  s1AltContactEmail: nullableText(200),
  s2LntPlan: nullableText(8000),
  s2LntLeadName: nullableText(200),
  s2LntLeadPhone: nullableText(60),
  s2LntLeadEmail: nullableText(200),
  s3ParticipationPlan: nullableText(8000),
  s3OperatingHours: z.array(OperatingHours).max(4).default([]),
  s3ScheduleDetail: nullableText(8000),
  s3GiftingFood: z.boolean().nullish().transform((v) => v ?? null),
  s4ExpectedPopulation: nullableInt(1_000_000),
  s4FirstArrivalDate: nullableText(40),
  s4WorkAccessPasses: nullableInt(100_000),
  s4AreaDimensions: nullableText(200),
  s4LayoutUploadUrls: z.array(z.string().url().max(2000)).max(4).default([]),
  s5AmplifiedMusic: nullableText(200),
  s5SoundPlan: nullableText(8000),
  s5PlacementFirstChoice: nullableText(200),
  s5PlacementSecondChoice: nullableText(200),
  s5NeighbourRequest: nullableText(500),
  s5FamilyFriendly: nullableText(500),
  s6SuppliersNote: nullableText(4000),
  s6PaidPerformers: z.boolean().nullish().transform((v) => v ?? null),
  s6FeeStructure: nullableText(8000),
  s6ExpectedBudgetZar: nullableInt(1_000_000_000),
  s6PlugAndPlayAck: z.boolean().nullish().transform((v) => v ?? null),
  supplierIds: z.array(z.string().uuid()).max(100).default([]),
});

async function requireCampAdmin(slug: string): Promise<
  | {
      ok: true;
      userId: string;
      group: { id: string; name: string };
      editionId: string;
      editionYear: number;
    }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  const [group] = await db()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group) return { ok: false, error: "Camp not found." };

  const [membership] = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.groupId, group.id),
      ),
    )
    .limit(1);
  if (!membership || !PROJECT_ADMIN_ROLES.includes(membership.role)) {
    return { ok: false, error: "Only a camp lead can edit the registration." };
  }

  return {
    ok: true,
    userId: user.id,
    group,
    editionId: edition.id,
    editionYear: edition.year,
  };
}

/** Autosave the wizard's current values to the draft. */
export async function saveRegistrationDraftAction(
  slug: string,
  rawValues: unknown,
): Promise<SaveDraftResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = RegistrationValuesSchema.safeParse(rawValues);
  if (!parsed.success) {
    return { ok: false, error: "Some answers weren't in the expected format." };
  }

  const result = await saveRegistrationDraft({
    group: gate.group,
    editionId: gate.editionId,
    values: parsed.data as RegistrationValues,
  });

  if (result.ok) revalidatePath(`/camps/${slug}/registration`);
  return result;
}

/** Submit (or resubmit) the registration: gate check → status → email. */
export async function submitRegistrationAction(
  slug: string,
): Promise<TransitionResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const current = await getRegistration(gate.group.id, gate.editionId);
  if (!current) return { ok: false, error: "Nothing to submit yet." };

  const action = current.status === "changes_requested" ? "resubmit" : "submit";
  const result = await applyCampAction({
    groupId: gate.group.id,
    editionId: gate.editionId,
    action,
  });
  if (!result.ok) return result;

  await notifySubmitted({
    campName: gate.group.name,
    contactEmail: current.s1ContactEmail,
    editionYear: gate.editionYear,
    resubmit: action === "resubmit",
  });

  revalidatePath(`/camps/${slug}/registration`);
  revalidatePath(`/camps/${slug}`);
  return result;
}

/** Withdraw the registration (voluntary). */
export async function withdrawRegistrationAction(
  slug: string,
): Promise<TransitionResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const result = await applyCampAction({
    groupId: gate.group.id,
    editionId: gate.editionId,
    action: "withdraw",
  });

  if (result.ok) {
    revalidatePath(`/camps/${slug}/registration`);
    revalidatePath(`/camps/${slug}`);
  }
  return result;
}

/** Fire the submission notification (Resend when configured; console otherwise). */
async function notifySubmitted(input: {
  campName: string;
  contactEmail: string | null;
  editionYear: number;
  resubmit: boolean;
}): Promise<void> {
  if (!input.contactEmail) return;
  const verb = input.resubmit ? "resubmitted" : "submitted";
  await sendEmail({
    to: input.contactEmail,
    subject: `${input.campName} — registration ${verb} for AfrikaBurn ${input.editionYear}`,
    text:
      `Thanks — we've ${verb} ${input.campName}'s theme camp registration for ` +
      `AfrikaBurn ${input.editionYear}.\n\n` +
      `AfrikaBurn's team will review it section by section. You'll get an email ` +
      `if they request changes, and you can track the status any time from your ` +
      `camp dashboard.\n\n` +
      `No further action is needed right now.\n\n— The AfrikaBurn Contributors app`,
  });
}

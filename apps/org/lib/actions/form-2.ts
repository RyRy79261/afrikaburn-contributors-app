"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  FORM_2_QUESTIONNAIRE_KEY,
  buildActivationRequiredActions,
  resolveAudience,
} from "@quagga/core";
import type { AudienceSpec } from "@quagga/types";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { buildAudienceContext } from "@/lib/questionnaires/queries";

// SENDING FORM 2 (roadmap M4-20).
//
// AfrikaBurn's second registration form, released in January to camps whose
// Form 1 was approved in September. It asks how big you are, where you want to
// be, what noise you will make, and for the mandatory layout diagram.
//
// ## One activation PER CAMP, not one for everybody
//
// The obvious shape — a single activation aimed at "registered camp leads" —
// cannot work, and the reason is worth stating because it looks like extra
// machinery until you hit it.
//
// Form 2 asks questions about a CAMP. `questionnaire_responses` is unique per
// (user, definition, edition, camp) since migration 0028, but `required_actions`
// is keyed on the ACTIVATION: one activation gives a person exactly one action
// and one answer. A person who leads two approved camps would therefore be asked
// once and answer once — for two camps with different sizes, different placement
// wishes and different sound. Whichever camp we mirrored that answer onto would
// be a guess, and the other camp's declaration would be silently wrong on the
// form AfrikaBurn places people with.
//
// So each approved camp gets its own activation, carrying its own `groupId`, and
// a lead of two camps is asked twice — which is what is actually being asked of
// them.
//
// ## Idempotent, because January is a busy month
//
// Sending twice must not double-ask anyone. Camps that already have an open
// Form-2 activation for this edition are skipped, and the result says how many
// — a silent "sent!" that actually sent nothing to half the list is how a
// deadline gets missed by people who were never asked.

export type Form2SendResult =
  | { ok: true; sent: number; skipped: number; message: string }
  | { ok: false; error: string };

const SendForm2Input = z.object({
  editionId: z.string().uuid(),
  /** Shown to the camp; defaults to the template's own title. */
  title: z.string().trim().min(1).default("Theme Camp Form 2"),
  description: z.string().trim().optional(),
  /** ISO date. Optional — AfrikaBurn's Form-2 deadline, when they set one. */
  dueAt: z.string().optional(),
});

/**
 * Fan Form 2 out to every approved theme camp for an edition.
 *
 * Guarded by `create` on `questionnaires` — the same capability that governs
 * sending any other questionnaire, because that is what this is.
 */
export async function sendForm2(
  raw: z.input<typeof SendForm2Input>,
): Promise<Form2SendResult> {
  try {
    const session = await requireOrgSession({
      capability: "create",
      domain: "questionnaires",
    });
    const input = SendForm2Input.parse(raw);
    const db = getDb();

    // The template. Seeded as org-owned reference data; if it is missing, say so
    // rather than sending an empty form.
    const [definition] = await db
      .select({
        key: schema.questionnaireDefinitions.key,
        version: schema.questionnaireDefinitions.version,
        title: schema.questionnaireDefinitions.title,
        definition: schema.questionnaireDefinitions.definition,
      })
      .from(schema.questionnaireDefinitions)
      .where(eq(schema.questionnaireDefinitions.key, FORM_2_QUESTIONNAIRE_KEY))
      .limit(1);
    if (!definition) {
      return {
        ok: false,
        error: `The Form 2 template (${FORM_2_QUESTIONNAIRE_KEY}) isn't in this deployment. It ships as seeded reference data — run the seed, or author it in the builder first.`,
      };
    }

    // APPROVED THEME CAMPS ONLY. A camp still under review has not been told it
    // is coming, and mutant vehicles and artworks run their own forms on their
    // own timelines (Art Form II, MV registration) — asking them for a camp
    // layout diagram would be asking a nonsense question.
    const camps = await db
      .select({
        groupId: schema.registrations.groupId,
        name: schema.groups.name,
      })
      .from(schema.registrations)
      .innerJoin(schema.groups, eq(schema.groups.id, schema.registrations.groupId))
      .where(
        and(
          eq(schema.registrations.editionId, input.editionId),
          eq(schema.registrations.status, "approved"),
          eq(schema.groups.kind, "theme_camp"),
        ),
      )
      .orderBy(asc(schema.groups.name));

    if (camps.length === 0) {
      return {
        ok: false,
        error:
          "No approved theme camps for this edition yet. Form 2 goes to camps whose Form 1 has been approved.",
      };
    }

    // Already sent? Idempotence is keyed on (questionnaire, edition, camp) with
    // the activation still open — a CLOSED one is a previous round and does not
    // block a re-send.
    const existing = await db
      .select({ groupId: schema.questionnaireActivations.groupId })
      .from(schema.questionnaireActivations)
      .where(
        and(
          eq(
            schema.questionnaireActivations.questionnaireKey,
            FORM_2_QUESTIONNAIRE_KEY,
          ),
          eq(schema.questionnaireActivations.editionId, input.editionId),
          eq(schema.questionnaireActivations.status, "open"),
          inArray(
            schema.questionnaireActivations.groupId,
            camps.map((c) => c.groupId),
          ),
        ),
      );
    const alreadySent = new Set(
      existing.map((r) => r.groupId).filter((id): id is string => Boolean(id)),
    );

    const pending = camps.filter((c) => !alreadySent.has(c.groupId));
    if (pending.length === 0) {
      return {
        ok: true,
        sent: 0,
        skipped: camps.length,
        message: `Every approved camp (${camps.length}) already has an open Form 2. Nothing re-sent.`,
      };
    }

    // Resolve every camp's leads from ONE context read rather than one per camp.
    const ctx = await buildAudienceContext(input.editionId, session.orgGroupId);
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    const now = new Date();

    // ONE TRANSACTION for the whole fan-out. A half-sent Form 2 is worse than an
    // unsent one: some camps are asked, the rest are not, and nothing on any
    // screen distinguishes "not asked" from "asked and ignoring it".
    const sent = await withTransaction(async (tx) => {
      let count = 0;
      for (const camp of pending) {
        const audience: AudienceSpec = {
          kind: "project",
          groupId: camp.groupId,
          mode: "leads",
          roleIds: [],
        };
        const userIds = resolveAudience(audience, ctx);
        // A camp with no resolvable lead cannot be asked. That should be
        // impossible — structural roles are the no-lockout backstop — but
        // creating an activation nobody can answer would leave a permanently
        // outstanding form on the chase list.
        if (userIds.length === 0) continue;

        const [activation] = await tx
          .insert(schema.questionnaireActivations)
          .values({
            questionnaireKey: definition.key,
            version: definition.version ?? "1",
            title: input.title,
            description: input.description ?? null,
            // NOT blocking. Form 2 opens in January and is due later; a blocking
            // questionnaire replaces the participant app entirely, which would
            // lock a camp lead out of everything else the moment it was sent.
            blocking: false,
            status: "open",
            dueAt,
            authoredScope: "org",
            groupId: camp.groupId,
            editionId: input.editionId,
            audience,
            definition: definition.definition,
            activatedByUserId: session.dbUserId,
            openedAt: now,
          })
          .returning({ id: schema.questionnaireActivations.id });
        if (!activation) throw new Error("Could not create a Form 2 activation.");

        const rows = buildActivationRequiredActions(
          {
            id: activation.id,
            title: input.title,
            blocking: false,
            dueAt,
          },
          userIds,
        );
        if (rows.length > 0) {
          await tx
            .insert(schema.requiredActions)
            .values(
              rows.map((r) => ({
                userId: r.userId,
                // Required actions are per-EDITION (migration 0024): without it
                // the uniqueness key is (user, action_key) forever and the same
                // action could never be raised again in a later burn.
                editionId: input.editionId,
                type: r.type,
                actionKey: r.actionKey,
                version: definition.version ?? "1",
                activationId: activation.id,
                title: r.title,
                blocking: r.blocking,
                status: r.status,
                dueAt: r.dueAt,
              })),
            )
            .onConflictDoNothing({
              target: [
                schema.requiredActions.userId,
                schema.requiredActions.editionId,
                schema.requiredActions.actionKey,
              ],
            });
        }
        count++;
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "questionnaire.activate",
        subject: FORM_2_QUESTIONNAIRE_KEY,
        meta: {
          form: "form_2",
          editionId: input.editionId,
          sent: count,
          skipped: camps.length - count,
        },
      });

      return count;
    });

    revalidatePath("/questionnaires");
    revalidatePath("/registrations");
    return {
      ok: true,
      sent,
      skipped: camps.length - sent,
      message:
        sent === camps.length
          ? `Form 2 sent to all ${sent} approved camps.`
          : `Form 2 sent to ${sent} camp${sent === 1 ? "" : "s"}; ${camps.length - sent} already had one open.`,
    };
  } catch (err) {
    unstable_rethrow(err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not send Form 2. Try again.",
    };
  }
}

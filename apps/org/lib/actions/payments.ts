"use server";

import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  assertPaymentTransition,
  assertRecordableAmount,
  deriveSubjectCode,
  generatePaymentReference,
} from "@quagga/core";
import { PaymentStatus } from "@quagga/types";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Payment TRACKING for a registration (App Spec §8; Decision 009, resolved
// 12 Aug 2026: tracking only, never a gateway).
//
// WHAT THIS DOES: gives a registration a unique reference, and lets a staff
// member tick "paid" once the money has arrived through AfrikaBurn's own
// channels.
//
// WHAT IT DOES NOT DO, AND CANNOT: take a card, hold a balance, move a cent,
// issue a refund, or tell anyone they owe money. There is no gateway integration
// behind this file and adding one is a Decision-009 reopening, not a feature.
// The `payments` row is a note about something that happened elsewhere — which
// is exactly why the amount is optional and the status is reversible.

const RecordInput = z.object({
  registrationId: z.string().uuid(),
  status: PaymentStatus,
  /** Optional note of what AfrikaBurn invoiced off-platform, in cents. */
  amountCents: z.number().int().nonnegative().nullish(),
});

/**
 * Record (or change) the payment status for a registration, creating the
 * reference on first use.
 *
 * THE REFERENCE IS GENERATED ONCE AND NEVER REGENERATED. It is the string a
 * camp has already put on an EFT and AfrikaBurn is already matching against a
 * bank statement; a "helpful" refresh when the camp code changes would silently
 * break a reconciliation that is halfway done in the real world.
 */
export async function recordRegistrationPayment(
  raw: z.input<typeof RecordInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = RecordInput.parse(raw);
    const amountCents = assertRecordableAmount(input.amountCents);
    const db = getDb();

    const [registration] = await db
      .select({
        id: schema.registrations.id,
        groupId: schema.registrations.groupId,
        campCode: schema.registrations.campCode,
        campName: schema.groups.name,
        editionYear: schema.editions.year,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.registrations.editionId),
      )
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    const [existing] = await db
      .select({
        id: schema.payments.id,
        status: schema.payments.status,
        reference: schema.payments.reference,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.subjectType, "registration"),
          eq(schema.payments.subjectId, registration.id),
        ),
      )
      .limit(1);

    if (existing) {
      // The state machine refuses a no-op, so an accidental double-submit of the
      // same status fails loudly rather than writing a second identical audit row.
      assertPaymentTransition(existing.status, input.status);
    }

    await withTransaction(async (tx) => {
      if (existing) {
        await tx
          .update(schema.payments)
          .set({
            status: input.status,
            amountCents: amountCents ?? undefined,
            recordedByUserId: session.dbUserId,
            updatedAt: new Date(),
          })
          .where(eq(schema.payments.id, existing.id));
      } else {
        // The camp's assigned code when it has one, otherwise derived from the
        // name — a reference has to exist before placement gets round to codes.
        const code =
          registration.campCode ?? deriveSubjectCode(registration.campName);

        // THE SEQUENCE IS NOT ALWAYS 1, and assuming it was is a real collision.
        // `deriveSubjectCode` takes the first three alphanumerics of the camp
        // name, so "Mad Hatters" and "Madness" both derive MAD. Two such camps
        // in one edition, neither assigned a camp code yet, would both mint
        // `QP-2027-MAD-001` — and `payments.reference` is unique, so the second
        // staff member to tick a box would get a raw constraint error.
        const prefix = `QP-${registration.editionYear}-${code}-`;
        const siblings = await tx
          .select({ reference: schema.payments.reference })
          .from(schema.payments)
          .where(like(schema.payments.reference, `${prefix}%`));
        const highest = siblings.reduce((max, row) => {
          const tail = Number(row.reference.slice(prefix.length));
          return Number.isInteger(tail) && tail > max ? tail : max;
        }, 0);

        await tx.insert(schema.payments).values({
          subjectType: "registration",
          subjectId: registration.id,
          reference: generatePaymentReference({
            year: registration.editionYear,
            code,
            sequence: highest + 1,
          }),
          status: input.status,
          amountCents: amountCents ?? undefined,
          recordedByUserId: session.dbUserId,
        });
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "registration.payment_record",
        subject: registration.groupId,
        meta: {
          registrationId: registration.id,
          status: input.status,
          previousStatus: existing?.status ?? null,
          amountCents,
        },
      });
    });

    revalidatePath(`/registrations/${registration.id}`);
  });
}

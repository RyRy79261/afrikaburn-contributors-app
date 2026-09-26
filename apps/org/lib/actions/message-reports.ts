"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  MESSAGE_REPORT_RESOLVE_AUDIT_ACTION,
  canResolveMessageReports,
  orgCapabilityRefusal,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Resolving a direct-message report (epic #69). The capability is the safety
// tier's: personal information in the registrations domain (to have read the
// report at all) plus `update` there (ordinary, reversible console work) —
// @quagga/core `canResolveMessageReports`. Resolving only moves the report's
// state; it never reaches the reported conversation, which the org cannot read.

const ResolveInput = z.object({
  reportId: z.string().uuid(),
});

export async function resolveMessageReportAction(
  input: unknown,
): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = ResolveInput.safeParse(input);
    if (!parsed.success) throw new Error("That request wasn't valid.");
    // Reading the report is the safety tier's authority; the guard throws the
    // honest refusal when it is missing.
    const state = await requireOrgSession({
      capability: "personal_information",
      domain: "registrations",
    });
    if (!canResolveMessageReports(state.actor)) {
      throw new Error(
        orgCapabilityRefusal(state.actor, "update", "registrations"),
      );
    }
    const db = getDb();
    const updated = await db
      .update(schema.messageReports)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: state.dbUserId,
      })
      .where(
        and(
          eq(schema.messageReports.id, parsed.data.reportId),
          eq(schema.messageReports.status, "open"),
        ),
      )
      .returning({ id: schema.messageReports.id });
    if (updated.length === 0) {
      throw new Error("That report is already resolved or no longer exists.");
    }
    await writeAuditEvent(db, {
      actorId: state.dbUserId,
      action: MESSAGE_REPORT_RESOLVE_AUDIT_ACTION,
      subject: parsed.data.reportId,
    });
    revalidatePath("/safety");
    revalidatePath(`/safety/${parsed.data.reportId}`);
  });
}

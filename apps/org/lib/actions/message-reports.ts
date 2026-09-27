"use server";

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  MESSAGE_REPORT_REOPEN_AUDIT_ACTION,
  MESSAGE_REPORT_RESOLVE_AUDIT_ACTION,
  canResolveMessageReports,
  orgCapabilityRefusal,
  type MessageReportStatus,
} from "@quagga/core";

import { schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { runAction, type ActionResult } from "./result";

// Resolving (and reopening) a direct-message report (epic #69). The capability is the safety
// tier's: personal information in the registrations domain (to have read the
// report at all) plus `update` there (ordinary, reversible console work) —
// @quagga/core `canResolveMessageReports`. Resolving only moves the report's
// state; it never reaches the reported conversation, which the org cannot read.

const ReportInput = z.object({
  reportId: z.string().uuid(),
});

export async function resolveMessageReportAction(
  input: unknown,
): Promise<ActionResult> {
  return setReportStatus(input, "resolved");
}

/** Undo a resolve made by mistake. Same capability as resolving: reopening is
 * the same ordinary, reversible state change in the other direction. */
export async function reopenMessageReportAction(
  input: unknown,
): Promise<ActionResult> {
  return setReportStatus(input, "open");
}

async function setReportStatus(
  input: unknown,
  to: MessageReportStatus,
): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = ReportInput.safeParse(input);
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
    const from: MessageReportStatus = to === "resolved" ? "open" : "resolved";
    // The state change and its audit row are ONE unit: a resolved report with
    // no record of who resolved it (or an audit row for a resolve that rolled
    // back) is the partial write `withTransaction` exists to prevent. The HTTP
    // driver (`getDb()`) has no transactions, so this runs on the pooled one.
    await withTransaction(async (tx) => {
      // Compare-and-set on the opposite status: a second resolve (or reopen)
      // matches nothing.
      const updated = await tx
        .update(schema.messageReports)
        .set(
          to === "resolved"
            ? {
                status: "resolved",
                resolvedAt: new Date(),
                resolvedBy: state.dbUserId,
              }
            : { status: "open", resolvedAt: null, resolvedBy: null },
        )
        .where(
          and(
            eq(schema.messageReports.id, parsed.data.reportId),
            eq(schema.messageReports.status, from),
            // An expired copy is hidden from every page and awaits the sweep;
            // it is not something to act on either.
            gt(schema.messageReports.expiresAt, new Date()),
          ),
        )
        .returning({ id: schema.messageReports.id });
      if (updated.length === 0) {
        throw new Error(
          to === "resolved"
            ? "That report is already resolved or no longer exists."
            : "That report is already open or no longer exists.",
        );
      }
      await writeAuditEvent(tx, {
        actorId: state.dbUserId,
        action:
          to === "resolved"
            ? MESSAGE_REPORT_RESOLVE_AUDIT_ACTION
            : MESSAGE_REPORT_REOPEN_AUDIT_ACTION,
        subject: parsed.data.reportId,
      });
    });
    revalidatePath("/safety");
    revalidatePath(`/safety/${parsed.data.reportId}`);
  });
}

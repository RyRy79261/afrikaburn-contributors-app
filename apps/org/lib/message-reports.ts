import "server-only";

import { after } from "next/server";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import {
  MESSAGE_REPORT_VIEW_AUDIT_ACTION,
  canReviewMessageReports,
  publicMemberName,
  type MessageReportStatus,
  type OrgActor,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";

// The org SAFETY QUEUE for direct-message reports (epic #69).
//
// WHAT THE ORG MAY SEE, AND NOTHING MORE: the COPIES of the messages a
// participant chose to report (`message_report_items`). This module never
// reads `messages`, `conversations` or `conversation_participants` — there is
// no query here that could return a message nobody reported, or the
// conversation around one. That is the whole boundary, and it is structural:
// the tables are simply not named in this file.
//
// WHO: `canReviewMessageReports` — personal information in the registrations
// domain, the same safety tier that reads medical notes (@quagga/core
// medical-access). Decided BEFORE any query. The list shows who reported whom
// and when; the messages themselves render only on a report's DETAIL view,
// and opening one writes a `dm.report.view` audit row (off the critical path
// via `after()`, like the medical read).

const LIST_CAP = 200;

export interface MessageReportSummary {
  id: string;
  status: MessageReportStatus;
  createdAt: Date;
  expiresAt: Date;
  reporterName: string;
  reportedName: string;
  messageCount: number;
}

export interface MessageReportDetail extends MessageReportSummary {
  reason: string | null;
  resolvedAt: Date | null;
  items: {
    id: string;
    senderName: string;
    fromReportedUser: boolean;
    kind: "text" | "system";
    body: string;
    sentAt: Date;
  }[];
}

function nameOf(
  row: { username: string | null; sanitizedAt: Date | null } | undefined,
): string {
  if (!row) return "Deleted account";
  return publicMemberName(row.username, { sanitizedAt: row.sanitizedAt });
}

async function namesFor(
  ids: readonly (string | null)[],
): Promise<Map<string, { username: string | null; sanitizedAt: Date | null }>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: schema.users.id,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * The queue, newest first, or null when this actor may not review reports.
 * Metadata only — no message body and no reason text is loaded for the list.
 * Reports past their retention are excluded even before the sweep runs.
 */
export async function listMessageReports(
  actor: OrgActor,
  status: MessageReportStatus,
  now: Date = new Date(),
): Promise<MessageReportSummary[] | null> {
  if (!canReviewMessageReports(actor)) return null;
  const db = getDb();
  const reports = await db
    .select({
      id: schema.messageReports.id,
      status: schema.messageReports.status,
      createdAt: schema.messageReports.createdAt,
      expiresAt: schema.messageReports.expiresAt,
      reporterId: schema.messageReports.reporterId,
      reportedUserId: schema.messageReports.reportedUserId,
    })
    .from(schema.messageReports)
    .where(
      and(
        eq(schema.messageReports.status, status),
        gt(schema.messageReports.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.messageReports.createdAt))
    .limit(LIST_CAP);
  if (reports.length === 0) return [];

  const [counts, names] = await Promise.all([
    db
      .select({
        reportId: schema.messageReportItems.reportId,
        n: count(),
      })
      .from(schema.messageReportItems)
      .where(
        inArray(
          schema.messageReportItems.reportId,
          reports.map((r) => r.id),
        ),
      )
      .groupBy(schema.messageReportItems.reportId),
    namesFor(reports.flatMap((r) => [r.reporterId, r.reportedUserId])),
  ]);
  const countOf = new Map(counts.map((c) => [c.reportId, Number(c.n)]));

  return reports.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    reporterName: nameOf(r.reporterId ? names.get(r.reporterId) : undefined),
    reportedName: nameOf(
      r.reportedUserId ? names.get(r.reportedUserId) : undefined,
    ),
    messageCount: countOf.get(r.id) ?? 0,
  }));
}

/**
 * One report with its copied messages, or null (refused, unknown or past its
 * retention — indistinguishable). A disclosing read writes an audit row.
 */
export async function getMessageReport(
  actor: OrgActor,
  viewerDbUserId: string,
  reportId: string,
  now: Date = new Date(),
): Promise<MessageReportDetail | null> {
  if (!canReviewMessageReports(actor)) return null;
  const db = getDb();
  const [report] = await db
    .select({
      id: schema.messageReports.id,
      status: schema.messageReports.status,
      createdAt: schema.messageReports.createdAt,
      expiresAt: schema.messageReports.expiresAt,
      resolvedAt: schema.messageReports.resolvedAt,
      reason: schema.messageReports.reason,
      reporterId: schema.messageReports.reporterId,
      reportedUserId: schema.messageReports.reportedUserId,
    })
    .from(schema.messageReports)
    .where(
      and(
        eq(schema.messageReports.id, reportId),
        gt(schema.messageReports.expiresAt, now),
      ),
    )
    .limit(1);
  if (!report) return null;

  const items = await db
    .select({
      id: schema.messageReportItems.id,
      senderId: schema.messageReportItems.senderId,
      kind: schema.messageReportItems.kind,
      body: schema.messageReportItems.body,
      sentAt: schema.messageReportItems.sentAt,
    })
    .from(schema.messageReportItems)
    .where(eq(schema.messageReportItems.reportId, report.id))
    .orderBy(schema.messageReportItems.sentAt);

  const names = await namesFor([
    report.reporterId,
    report.reportedUserId,
    ...items.map((i) => i.senderId),
  ]);

  after(async () => {
    try {
      await getDb()
        .insert(schema.auditEvents)
        .values({
          actorId: viewerDbUserId,
          action: MESSAGE_REPORT_VIEW_AUDIT_ACTION,
          subject: report.id,
          meta: { messages: items.length },
        });
    } catch (err) {
      console.error("[message-reports] audit write failed", err);
    }
  });

  return {
    id: report.id,
    status: report.status,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
    resolvedAt: report.resolvedAt,
    reason: report.reason,
    reporterName: nameOf(
      report.reporterId ? names.get(report.reporterId) : undefined,
    ),
    reportedName: nameOf(
      report.reportedUserId ? names.get(report.reportedUserId) : undefined,
    ),
    messageCount: items.length,
    items: items.map((i) => ({
      id: i.id,
      senderName: nameOf(i.senderId ? names.get(i.senderId) : undefined),
      fromReportedUser:
        i.senderId != null && i.senderId === report.reportedUserId,
      kind: i.kind,
      body: i.body,
      sentAt: i.sentAt,
    })),
  };
}

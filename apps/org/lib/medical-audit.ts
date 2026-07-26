import "server-only";

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  MEDICAL_VIEW_AUDIT_ACTION,
  publicMemberName,
  type MedicalAccessBasis,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";

// The READER for `bio.medical.view` audit rows — the half that was missing.
//
// The medical read path is deliberately fail-open (AGENTS.md: an emergency read
// must never be blocked or slowed by its own audit write, so the insert runs in
// `after()` and a failed insert is logged, not surfaced). That is the right
// call, and it makes the audit trail the ONLY control against a camp lead
// walking their whole roster. A trail nothing ever reads is not a control, so
// these queries + the `/audit` console page exist to make "enumeration stays
// detectable" true rather than aspirational.
//
// Note what this deliberately is NOT: a block. Nothing here can refuse a read;
// by the time a row exists the notes were already shown. It is detection and
// attribution, which is what the fail-open trade demands in exchange.

/** How far back the console looks. Long enough to cover a whole build week. */
export const MEDICAL_AUDIT_LOOKBACK_DAYS = 30;

/** Hard cap on rows pulled — a busy edition must not OOM a page. */
const MEDICAL_AUDIT_ROW_CAP = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One disclosing read, resolved for display. */
export interface MedicalReadRow {
  id: string;
  actorId: string | null;
  /** Actor's account email, or null (deleted/sanitized actor). */
  actorEmail: string | null;
  /** `audit_events.subject` — the burner whose notes were read. */
  subjectId: string | null;
  /** The burner's display name, or null when no bio row resolves. */
  subjectName: string | null;
  /** Which authority the read rested on, when the row recorded one. */
  basis: MedicalAccessBasis | null;
  createdAt: Date;
}

export interface MedicalAccessLog {
  rows: MedicalReadRow[];
  /** True when the row cap was hit, so the page can say the view is partial. */
  truncated: boolean;
  lookbackDays: number;
}

function parseBasis(meta: Record<string, unknown> | null): MedicalAccessBasis | null {
  const value = meta?.basis;
  return value === "self" || value === "org_staff" || value === "camp_lead"
    ? value
    : null;
}

function lookbackStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Every `bio.medical.view` row in the lookback window, newest first, with the
 * actor's email and the subject's display name resolved.
 *
 * A PLAIN CHRONOLOGICAL RECORD, deliberately. It carries no per-actor
 * aggregation, no volume threshold and no alerting, because reading many
 * members' notes in one sitting is what the job looks like — a medic working
 * out what to prepare for on site does exactly that, and flagging it would
 * report normal care as an incident while teaching staff that the safety tool
 * watches them. (Ryan, 26 Jul 2026.)
 *
 * `audit_events.subject` is `text` and holds ids for several row kinds, so
 * subject names are resolved in a SECOND query over the ids that actually look
 * like UUIDs — casting the column in a join would let one malformed historical
 * row error the whole page, and this page must always render.
 */
export async function getMedicalAccessLog(
  options: { lookbackDays?: number; limit?: number } = {},
): Promise<MedicalAccessLog> {
  const lookbackDays = options.lookbackDays ?? MEDICAL_AUDIT_LOOKBACK_DAYS;
  const limit = Math.min(options.limit ?? MEDICAL_AUDIT_ROW_CAP, MEDICAL_AUDIT_ROW_CAP);
  const db = getDb();

  const rows = await db
    .select({
      id: schema.auditEvents.id,
      actorId: schema.auditEvents.actorId,
      actorEmail: schema.users.email,
      subjectId: schema.auditEvents.subject,
      meta: schema.auditEvents.meta,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(
      and(
        eq(schema.auditEvents.action, MEDICAL_VIEW_AUDIT_ACTION),
        gte(schema.auditEvents.createdAt, lookbackStart(lookbackDays)),
      ),
    )
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);

  const subjectIds = [
    ...new Set(
      rows.flatMap((r) => (r.subjectId && UUID_RE.test(r.subjectId) ? [r.subjectId] : [])),
    ),
  ];

  const names = new Map<string, string>();
  if (subjectIds.length > 0) {
    const bios = await db
      .select({
        userId: schema.burnerBios.userId,
        displayName: schema.burnerBios.displayName,
      })
      .from(schema.burnerBios)
      .where(inArray(schema.burnerBios.userId, subjectIds));
    for (const bio of bios) {
      if (!names.has(bio.userId)) {
        names.set(bio.userId, publicMemberName(bio.displayName));
      }
    }
  }

  const resolved: MedicalReadRow[] = rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorEmail: r.actorEmail,
    subjectId: r.subjectId,
    subjectName: r.subjectId ? (names.get(r.subjectId) ?? null) : null,
    basis: parseBasis(r.meta),
    createdAt: r.createdAt,
  }));

  return {
    rows: resolved,
    truncated: rows.length >= limit,
    lookbackDays,
  };
}

export interface AuditTrailRow {
  id: string;
  action: string;
  actorEmail: string | null;
  subject: string | null;
  createdAt: Date;
}

export async function getAuditTrail(limit = 100): Promise<AuditTrailRow[]> {
  const db = getDb();
  return db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      actorEmail: schema.users.email,
      subject: schema.auditEvents.subject,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);
}

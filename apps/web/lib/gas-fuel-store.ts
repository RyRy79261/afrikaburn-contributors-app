import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  canEditGasFuelRecord,
  canViewGasFuelRecord,
  copyGasFuelRecordForNewEdition,
  decideFuelDepotNotice,
  decideGasFuelSave,
  decideStartGasFuelFromLastYear,
  describeGasFuelRecord,
  fuelDepotAdvice,
  fuelDepotNotification,
  gasFuelRefusalMessage,
  publicMemberName,
  tidyGasFuelRecord,
  waterEstimateLitres,
  type GasFuelRefusal,
} from "@quagga/core";
import {
  GasFuelRecord,
  SaveGasFuelRecordInput,
  StartGasFuelFromLastYearInput,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";
import {
  findCamp,
  loadLayoutAccess,
  lockLayoutActor,
  type LayoutAccess,
  type LayoutEdition,
} from "./camp-layout-store";
import { insertNotifications } from "./notifications";

// The optional gas & fuel record (docs/registration-safety-spec.md §"The gas &
// fuel record"). Every rule — who may edit, the fuel depot thresholds, the
// edge-triggered notices, carry-forward — is a pure @quagga/core function in
// registration-safety.ts; this file loads the facts from the database (never
// from the request) and writes.
//
// SCOPING: the same as the layout. A request names a camp by slug; the
// caller's active membership is resolved for it, and the record is found
// through the camp's registration for the ACTIVE edition. Strangers and former
// members get null from reads and "Camp not found." from writes.
//
// DRAFTS: a record carried forward from last year is stored `is_draft` and
// counts for nothing until the camp saves it. Every read in this file except
// the record page's own (`loadGasFuelPage`) ignores drafts.
//
// NOTICES: edge-triggered, decided inside the save's transaction (the
// registration row is locked FOR UPDATE, so two saves cannot both see "not
// told yet"), sent best-effort after commit. A failure to notify never rolls
// back a save.

export type GasFuelResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function refused(reason: GasFuelRefusal): { ok: false; error: string } {
  return { ok: false, error: gasFuelRefusalMessage(reason) };
}

const INVALID = "That record couldn't be saved. Check the numbers and try again.";

export interface GasFuelAccess extends LayoutAccess {
  canEditRecord: boolean;
}

/** The viewer's access to a camp's gas & fuel record, or null (not a theme
 * camp, not a current member, no such camp). */
export async function loadGasFuelAccess(
  slug: string,
  viewerUserId: string,
): Promise<GasFuelAccess | null> {
  const access = await loadLayoutAccess(slug, viewerUserId);
  // The record's own read predicate, enforced here so the rule @quagga/core
  // tests is the one the page obeys — not merely the layout's.
  if (!access || !canViewGasFuelRecord(access.membership)) return null;
  return { ...access, canEditRecord: canEditGasFuelRecord(access.membership) };
}

export interface StoredGasFuelRecord {
  record: GasFuelRecord;
  isDraft: boolean;
  campNotifiedAt: Date | null;
  wranglerNotifiedAt: Date | null;
  updatedAt: Date;
  updatedByName: string | null;
}

/** Parse a stored record; a row that no longer parses reads as empty rather
 * than crashing a page. */
function parseStored(raw: unknown): GasFuelRecord | null {
  const parsed = GasFuelRecord.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function registrationIdFor(
  groupId: string,
  editionId: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ id: schema.registrations.id })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** The wrangler holding this camp for this edition, or null. */
export async function findCampWrangler(
  groupId: string,
  editionId: string,
): Promise<{ userId: string; name: string } | null> {
  const [row] = await db()
    .select({
      userId: schema.wranglerAssignments.wranglerUserId,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.wranglerAssignments)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.wranglerAssignments.wranglerUserId),
    )
    .where(
      and(
        eq(schema.wranglerAssignments.groupId, groupId),
        eq(schema.wranglerAssignments.editionId, editionId),
      ),
    )
    .limit(1);
  if (!row?.userId) return null;
  return {
    userId: row.userId,
    name: publicMemberName(row.username, { sanitizedAt: row.sanitizedAt }),
  };
}

/** A registration's record row, drafts included — the record page only. */
async function recordRow(
  registrationId: string,
): Promise<StoredGasFuelRecord | null> {
  const [row] = await db()
    .select({
      record: schema.campGasFuelRecords.record,
      isDraft: schema.campGasFuelRecords.isDraft,
      campNotifiedAt: schema.campGasFuelRecords.campNotifiedAt,
      wranglerNotifiedAt: schema.campGasFuelRecords.wranglerNotifiedAt,
      updatedAt: schema.campGasFuelRecords.updatedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.campGasFuelRecords)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.campGasFuelRecords.updatedByUserId),
    )
    .where(eq(schema.campGasFuelRecords.registrationId, registrationId))
    .limit(1);
  if (!row) return null;
  const record = parseStored(row.record);
  if (!record) return null;
  return {
    record,
    isDraft: row.isDraft,
    campNotifiedAt: row.campNotifiedAt,
    wranglerNotifiedAt: row.wranglerNotifiedAt,
    updatedAt: row.updatedAt,
    updatedByName:
      row.username === null && row.sanitizedAt === null
        ? null
        : publicMemberName(row.username, { sanitizedAt: row.sanitizedAt }),
  };
}

/**
 * The SAVED (non-draft) record for a registration, or null. What every
 * surface other than the record page reads: section 4, the dashboard tile.
 * Not an authz boundary — callers have already decided the viewer may see it.
 */
export async function getSavedGasFuelRecord(
  registrationId: string,
): Promise<StoredGasFuelRecord | null> {
  const row = await recordRow(registrationId);
  return row && !row.isDraft ? row : null;
}

/** The most recent EARLIER edition's saved record for this camp.
 *
 * The year and the draft flag are checked again on the rows, not only in the
 * WHERE: "never offer a draft, never offer this edition's own row" is the rule,
 * and a unit test can see this filter where it cannot see SQL. A camp has one
 * row per edition, so reading them all costs nothing. */
async function findGasFuelSource(
  handle: Tx | ReturnType<typeof db>,
  groupId: string,
  currentYear: number,
): Promise<{ editionYear: number; record: GasFuelRecord } | null> {
  const rows = await handle
    .select({
      editionYear: schema.editions.year,
      isDraft: schema.campGasFuelRecords.isDraft,
      record: schema.campGasFuelRecords.record,
    })
    .from(schema.campGasFuelRecords)
    .innerJoin(
      schema.registrations,
      eq(schema.registrations.id, schema.campGasFuelRecords.registrationId),
    )
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        lt(schema.editions.year, currentYear),
        // Only what a camp SAVED: last year's unsaved draft is nobody's plan.
        eq(schema.campGasFuelRecords.isDraft, false),
      ),
    )
    .orderBy(desc(schema.editions.year));
  const row = rows
    .filter((r) => !r.isDraft && r.editionYear < currentYear)
    .sort((a, b) => b.editionYear - a.editionYear)[0];
  if (!row) return null;
  const record = parseStored(row.record);
  return record ? { editionYear: row.editionYear, record } : null;
}

export interface GasFuelPageView {
  registrationId: string | null;
  /** This edition's row, draft or saved; null when none. */
  stored: StoredGasFuelRecord | null;
  /** An earlier record to start from — editors only, only while none. */
  lastYear: { editionYear: number; record: GasFuelRecord } | null;
  /** For a carried-forward draft: the year it came from ("Draft from your
   * 2026 record"), resolved the way the offer resolved it; null otherwise. */
  draftSourceYear: number | null;
  wranglerName: string | null;
}

/** Everything the record page needs, shaped for the viewer. */
export async function loadGasFuelPage(
  access: GasFuelAccess,
  edition: LayoutEdition,
): Promise<GasFuelPageView> {
  const registrationId = await registrationIdFor(access.camp.id, edition.id);
  if (!registrationId) {
    return {
      registrationId: null,
      stored: null,
      lastYear: null,
      draftSourceYear: null,
      wranglerName: null,
    };
  }
  const [stored, wrangler] = await Promise.all([
    recordRow(registrationId),
    findCampWrangler(access.camp.id, edition.id),
  ]);
  const source =
    (!stored && access.canEditRecord) || stored?.isDraft
      ? await findGasFuelSource(db(), access.camp.id, edition.year)
      : null;
  return {
    registrationId,
    stored,
    lastYear: !stored && access.canEditRecord ? source : null,
    draftSourceYear: stored?.isDraft ? (source?.editionYear ?? null) : null,
    wranglerName: wrangler?.name ?? null,
  };
}

// --- Writes ------------------------------------------------------------------------

interface WriteContext {
  camp: { id: string; name: string; slug: string };
  registrationId: string | null;
  canEdit: boolean;
}

/** Parse → find camp → tx → lock actor → lock the registration row. */
async function withGasFuelWrite<T>(
  slug: string,
  viewerUserId: string,
  edition: LayoutEdition,
  fn: (tx: Tx, ctx: WriteContext) => Promise<GasFuelResult<T>>,
): Promise<GasFuelResult<T>> {
  const camp = await findCamp(slug);
  if (!camp) return refused("not_found");
  return withTransaction(async (tx) => {
    const actor = await lockLayoutActor(tx, camp.id, viewerUserId);
    if (!actor) return refused("not_found");
    // FOR UPDATE on the registration serialises saves of this camp's record,
    // so the edge decision ("not told yet") is taken by one save at a time.
    const [reg] = await tx
      .select({ id: schema.registrations.id })
      .from(schema.registrations)
      .where(
        and(
          eq(schema.registrations.groupId, camp.id),
          eq(schema.registrations.editionId, edition.id),
        ),
      )
      .limit(1)
      .for("update");
    return fn(tx, {
      camp: { id: camp.id, name: camp.name, slug: camp.slug },
      registrationId: reg?.id ?? null,
      canEdit: canEditGasFuelRecord(actor.permissions),
    });
  });
}

interface PendingNotices {
  registrationId: string;
  camp: { id: string; name: string; slug: string };
  sendCamp: boolean;
  sendWrangler: boolean;
  wrangler: { userId: string; name: string } | null;
}

/**
 * Save the record: it stops being a draft, and the fuel depot notice is
 * decided on the edge. Returns whether the record goes to the depot.
 */
export async function saveGasFuelRecord(
  viewerUserId: string,
  edition: LayoutEdition,
  raw: unknown,
): Promise<GasFuelResult<{ advice: boolean }>> {
  const parsed = SaveGasFuelRecordInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const record = tidyGasFuelRecord(parsed.data.record);
  const advice = fuelDepotAdvice(record);

  let pending: PendingNotices | null = null;
  const result = await withGasFuelWrite<{ advice: boolean }>(
    parsed.data.slug,
    viewerUserId,
    edition,
    async (tx, ctx) => {
      const refusal = decideGasFuelSave({
        canEdit: ctx.canEdit,
        hasRegistration: ctx.registrationId !== null,
      });
      if (refusal || !ctx.registrationId) {
        return refused(refusal ?? "no_registration");
      }
      const [existing] = await tx
        .select({
          id: schema.campGasFuelRecords.id,
          campNotifiedAt: schema.campGasFuelRecords.campNotifiedAt,
          wranglerNotifiedAt: schema.campGasFuelRecords.wranglerNotifiedAt,
        })
        .from(schema.campGasFuelRecords)
        .where(eq(schema.campGasFuelRecords.registrationId, ctx.registrationId))
        .limit(1)
        .for("update");
      const wrangler = await findCampWrangler(ctx.camp.id, edition.id);
      const decision = decideFuelDepotNotice({
        isDraft: false,
        advice,
        campNotifiedAt: existing?.campNotifiedAt ?? null,
        wranglerNotifiedAt: existing?.wranglerNotifiedAt ?? null,
        wranglerAssigned: wrangler !== null,
      });
      const now = new Date();
      const stamp = (
        d: "set" | "clear" | "keep",
        current: Date | null,
      ): Date | null => (d === "set" ? now : d === "clear" ? null : current);
      const values = {
        record,
        isDraft: false,
        campNotifiedAt: stamp(
          decision.campNotifiedAt,
          existing?.campNotifiedAt ?? null,
        ),
        wranglerNotifiedAt: stamp(
          decision.wranglerNotifiedAt,
          existing?.wranglerNotifiedAt ?? null,
        ),
        updatedByUserId: viewerUserId,
        updatedAt: now,
      };
      if (existing) {
        await tx
          .update(schema.campGasFuelRecords)
          .set(values)
          .where(eq(schema.campGasFuelRecords.id, existing.id));
      } else {
        await tx
          .insert(schema.campGasFuelRecords)
          .values({ registrationId: ctx.registrationId, ...values });
      }
      if (decision.sendCamp || decision.sendWrangler) {
        pending = {
          registrationId: ctx.registrationId,
          camp: ctx.camp,
          sendCamp: decision.sendCamp,
          sendWrangler: decision.sendWrangler,
          wrangler,
        };
      }
      return { ok: true, advice };
    },
  );
  if (result.ok && pending) await sendFuelDepotNotices(pending);
  return result;
}

/**
 * Insert the notices. Best-effort, after commit — exactly as the wrangler
 * assignment hook does. In-app only: `wrangler` notifications never send an
 * immediate email (`shouldSendImmediateEmail`); an unread one can appear in
 * the daily digest like any other.
 */
async function sendFuelDepotNotices(p: PendingNotices): Promise<void> {
  try {
    const rows = [];
    if (p.sendCamp) {
      const leads = await db()
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.groupId, p.camp.id),
            inArray(schema.memberships.role, ["lead", "admin"]),
            activeMembership(),
          ),
        );
      const payload = fuelDepotNotification({
        side: "camp",
        campName: p.camp.name,
        campSlug: p.camp.slug,
        registrationId: p.registrationId,
        wranglerName: p.wrangler?.name ?? null,
      });
      // A wrangler who also leads the camp gets the wrangler copy only.
      const ids = [...new Set(leads.map((l) => l.userId))].filter(
        (id) => id !== p.wrangler?.userId,
      );
      for (const userId of ids) {
        rows.push({ ...payload, userId, origin: "system" as const });
      }
    }
    if (p.sendWrangler && p.wrangler) {
      rows.push({
        ...fuelDepotNotification({
          side: "wrangler",
          campName: p.camp.name,
          campSlug: p.camp.slug,
          registrationId: p.registrationId,
        }),
        userId: p.wrangler.userId,
        origin: "system" as const,
      });
    }
    await insertNotifications(db(), rows);
  } catch (err) {
    console.error("[notifications] fuel depot notice failed", err);
  }
}

/** "Start from 2026": last year's saved record, copied in as a DRAFT. One
 * click, never automatic, never over an existing record. */
export async function startGasFuelFromLastYear(
  viewerUserId: string,
  edition: LayoutEdition,
  raw: unknown,
): Promise<GasFuelResult> {
  const parsed = StartGasFuelFromLastYearInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  return withGasFuelWrite(parsed.data.slug, viewerUserId, edition, async (tx, ctx) => {
    const [existing] = ctx.registrationId
      ? await tx
          .select({ id: schema.campGasFuelRecords.id })
          .from(schema.campGasFuelRecords)
          .where(eq(schema.campGasFuelRecords.registrationId, ctx.registrationId))
          .limit(1)
      : [];
    const source = await findGasFuelSource(tx, ctx.camp.id, edition.year);
    const refusal = decideStartGasFuelFromLastYear({
      canEdit: ctx.canEdit,
      hasRegistration: ctx.registrationId !== null,
      hasRecord: existing !== undefined,
      hasSource: source !== null,
    });
    if (refusal || !ctx.registrationId || !source) {
      return refused(refusal ?? "no_source");
    }
    await tx.insert(schema.campGasFuelRecords).values({
      registrationId: ctx.registrationId,
      record: copyGasFuelRecordForNewEdition(source.record),
      // A DRAFT: no depot advice to anyone, no notice, not in the org review,
      // until the camp checks it and saves.
      isDraft: true,
      updatedByUserId: viewerUserId,
    });
    return { ok: true };
  });
}

// --- The camp dashboard tile ------------------------------------------------------

export interface GasFuelTileSummary {
  /** The saved record's one-line summary; null when none is saved (a draft
   * reads as "Not started"). */
  savedSummary: string | null;
  advice: boolean;
  /** The rough water guide, from section 4's population and first arrival. */
  water: { litres: number; people: number } | null;
}

/** The tile's facts, for a current member (the caller passed `access`). */
export async function getGasFuelTileSummary(
  access: GasFuelAccess,
  edition: LayoutEdition & { endDate: string },
): Promise<GasFuelTileSummary> {
  const [reg] = await db()
    .select({
      id: schema.registrations.id,
      population: schema.registrations.s4ExpectedPopulation,
      arrival: schema.registrations.s4FirstArrivalDate,
    })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, access.camp.id),
        eq(schema.registrations.editionId, edition.id),
      ),
    )
    .limit(1);
  if (!reg) return { savedSummary: null, advice: false, water: null };
  const saved = await getSavedGasFuelRecord(reg.id);
  const water = waterEstimateLitres({
    population: reg.population,
    firstArrivalDate: reg.arrival,
    editionEndDate: edition.endDate,
  });
  return {
    savedSummary: saved ? describeGasFuelRecord(saved.record) : null,
    advice: saved ? fuelDepotAdvice(saved.record) : false,
    water: water ? { litres: water.litres, people: water.people } : null,
  };
}

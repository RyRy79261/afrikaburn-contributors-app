import "server-only";

import { and, inArray, isNotNull, or } from "drizzle-orm";
import {
  ID_RETENTION_GRACE_DAYS,
  buildIdPurgePatch,
  identifyPurgeableIdBios,
  isIdRetentionExpired,
  type RetentionBio,
  type RetentionEdition,
} from "@quagga/core";
import { db, schema, withTransaction } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/config";

// THE CALLER `packages/core/src/id-retention.ts` WAS WRITTEN FOR AND NEVER GOT.
//
// That module owns the RULE — which editions have aged out, and what a purge
// patch looks like — and says in its own header that the scheduled job applying
// it is "a LATER task". `packages/db/src/schema.ts` says the same thing above
// the two columns. Meanwhile ID fields were added to the carry-forward set, so
// an SA ID or passport number now propagates into each new edition's bio. The
// rule was tested; nothing ever ran it. On a live product under POPIA's
// storage-limitation principle that is retention growing without bound, with
// the control written down and switched off.
//
// This is that caller. It does the I/O the pure module refuses to do: select
// the editions and the bios, hand them to `identifyPurgeableIdBios`, and apply
// `buildIdPurgePatch()` to what comes back.
//
// CIPHERTEXT IS NEVER LOADED. `RetentionBio` types the two columns as
// `string | null` because the rule only asks whether ID data is PRESENT —
// `bioHasIdData` compares against null and never looks at the value. So this
// selects `isNotNull(...)` booleans and rebuilds the shape with a sentinel,
// rather than pulling encrypted identity documents into application memory to
// decide whether to delete them. Reading a thing in order to erase it is the
// one access this job has no need of.
//
// THE EDITION FILTER IS IN THE SQL, BEFORE THE LIMIT. Carry-forward copies ID
// ciphertext into every new edition's bio, so most rows holding an ID belong to
// editions that have NOT expired. The bio select once carried only "holds an
// ID" and `.limit()`, with the expiry rule applied afterwards in JS: once more
// than `limit` live rows held an ID, every batch could be all live rows, purge
// nothing, report success, and leave the expired backlog in place forever. So
// the expired editions are worked out first, and the bio select names them.
// `identifyPurgeableIdBios` still runs over the result as defence in depth.
//
// THE ACTIVE EDITION IS NEVER PURGED, whatever its `end_date` says. A wrong date
// on the live edition would otherwise erase current IDs after the grace window,
// and an erasure cannot be undone. Refusing costs at most a delayed purge.

/** What a single bio's purge did. `ok: false` carries the reason. */
export interface IdPurgeOutcome {
  ok: boolean;
  bioId: string;
  editionId: string;
  error?: string;
}

export interface IdRetentionSweepResult {
  /** Bios examined — those holding ID data on an expired edition. */
  identified: number;
  purged: number;
  failures: IdPurgeOutcome[];
  /** Editions whose window had elapsed and which held purgeable data. */
  editionIds: string[];
}

/** Audit action for the run marker. One row per run, never per burner: an audit
 *  trail that pairs a person with "their ID document was erased" would recreate
 *  a thinner version of the record this job exists to remove. */
export const ID_PURGE_AUDIT_ACTION = "bio.id_retention_purge";

/**
 * Purge ID documents whose retention window has elapsed.
 *
 * `limit` bounds one run so a first execution against years of accumulated
 * editions cannot take a statement timeout with it. The limit counts only rows
 * on expired, inactive editions (see the header), so every run with a backlog
 * purges up to `limit` rows; the job is idempotent and a daily schedule drains
 * the backlog. Returns what it did so the route can answer honestly — a partial
 * failure is not a successful run.
 */
export async function sweepExpiredIdDocuments(
  now: Date = new Date(),
  limit = 500,
  graceDays: number = ID_RETENTION_GRACE_DAYS,
): Promise<IdRetentionSweepResult> {
  const empty: IdRetentionSweepResult = {
    identified: 0,
    purged: 0,
    failures: [],
    editionIds: [],
  };
  if (!isDatabaseConfigured()) return empty;

  const editionRows = await db()
    .select({
      id: schema.editions.id,
      endDate: schema.editions.endDate,
      isActive: schema.editions.isActive,
    })
    .from(schema.editions);
  // Expired by the same rule `identifyPurgeableIdBios` applies, and never the
  // active edition. See the header.
  const editions: RetentionEdition[] = editionRows
    .filter((e) => !e.isActive)
    .map((e) => ({ id: e.id, endDate: e.endDate }))
    .filter((e) => isIdRetentionExpired(e, now, graceDays));
  if (editions.length === 0) return empty;
  const expiredEditionIds = editions.map((e) => e.id);

  // Only rows that still hold something to purge, on an expired edition. The
  // `or(isNotNull…)` is the same condition `bioHasIdData` applies; the edition
  // filter keeps the limit from filling with rows the rule would refuse. Ordered
  // so each batch is deterministic.
  const bioRows = await db()
    .select({
      id: schema.burnerBios.id,
      editionId: schema.burnerBios.editionId,
      hasSaId: isNotNull(schema.burnerBios.saIdEncrypted),
      hasPassport: isNotNull(schema.burnerBios.passportEncrypted),
    })
    .from(schema.burnerBios)
    .where(
      and(
        inArray(schema.burnerBios.editionId, expiredEditionIds),
        or(
          isNotNull(schema.burnerBios.saIdEncrypted),
          isNotNull(schema.burnerBios.passportEncrypted),
        ),
      ),
    )
    .orderBy(schema.burnerBios.id)
    .limit(limit);

  // PRESENT-OR-ABSENT, not the value. See the note at the top of this file.
  const PRESENT = "present";
  const bios: RetentionBio[] = bioRows.map((b) => ({
    id: b.id,
    editionId: b.editionId,
    saIdEncrypted: b.hasSaId ? PRESENT : null,
    passportEncrypted: b.hasPassport ? PRESENT : null,
  }));

  const purgeable = identifyPurgeableIdBios({
    now,
    editions,
    bios,
    graceDays,
  });
  if (purgeable.length === 0) return empty;

  const editionIds = [...new Set(purgeable.map((p) => p.editionId))];
  const failures: IdPurgeOutcome[] = [];
  let purged = 0;

  // ONE TRANSACTION, so the audit row and the erasure cannot disagree. A run
  // that half-committed would leave a trail claiming an erasure that did not
  // happen, which is worse than no trail.
  try {
    await withTransaction(async (tx) => {
      await tx
        .update(schema.burnerBios)
        .set(buildIdPurgePatch())
        .where(
          and(
            inArray(
              schema.burnerBios.id,
              purgeable.map((p) => p.bioId),
            ),
            or(
              isNotNull(schema.burnerBios.saIdEncrypted),
              isNotNull(schema.burnerBios.passportEncrypted),
            ),
          ),
        );

      await tx.insert(schema.auditEvents).values({
        action: ID_PURGE_AUDIT_ACTION,
        subject: `editions:${editionIds.join(",")}`,
        meta: {
          purgedBios: purgeable.length,
          editionIds,
          graceDays,
          sweptAt: now.toISOString(),
        },
      });
    });
    purged = purgeable.length;
  } catch (err) {
    // The whole batch rolled back — report every row as unpurged rather than
    // letting a caller infer success from an absence of failures.
    const error = err instanceof Error ? err.message : String(err);
    for (const p of purgeable) {
      failures.push({ ok: false, bioId: p.bioId, editionId: p.editionId, error });
    }
  }

  return { identified: purgeable.length, purged, failures, editionIds };
}

/** Re-exported so the route and its tests share one name for the grace window. */
export { ID_RETENTION_GRACE_DAYS };

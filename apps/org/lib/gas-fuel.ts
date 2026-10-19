import "server-only";

import { and, eq } from "drizzle-orm";
import { orgCanInDomain, type OrgActor } from "@quagga/core";
import { GasFuelRecord } from "@quagga/types";
import { getDb, schema } from "./db";

// The camp's gas & fuel record, as the registration review shows it
// (docs/registration-safety-spec.md §"Org review"). A CAMP RECORD, not part of
// the submission, so it is read LIVE — the one exception to the review's
// pinned-snapshot rule — but only once SAVED: a carried-forward draft is never
// the camp's plan, and is invisible here.
//
// WHO. Whoever can already read the registration in the console
// (`read` in `registrations`); no new capability. Refused before any query.

export interface GasFuelForReview {
  record: GasFuelRecord;
  updatedAt: Date;
  campNotifiedAt: Date | null;
  wranglerNotifiedAt: Date | null;
}

export async function getSavedGasFuelForReview(
  registrationId: string,
  actor: OrgActor,
): Promise<GasFuelForReview | null> {
  if (!orgCanInDomain(actor, "read", "registrations")) return null;
  const [row] = await getDb()
    .select({
      record: schema.campGasFuelRecords.record,
      updatedAt: schema.campGasFuelRecords.updatedAt,
      campNotifiedAt: schema.campGasFuelRecords.campNotifiedAt,
      wranglerNotifiedAt: schema.campGasFuelRecords.wranglerNotifiedAt,
      isDraft: schema.campGasFuelRecords.isDraft,
    })
    .from(schema.campGasFuelRecords)
    .where(
      and(
        eq(schema.campGasFuelRecords.registrationId, registrationId),
        eq(schema.campGasFuelRecords.isDraft, false),
      ),
    )
    .limit(1);
  // Checked again on the row, not only in the WHERE: "a draft is never shown"
  // is the rule, and a unit test can see this line where it cannot see SQL.
  if (!row || row.isDraft) return null;
  const parsed = GasFuelRecord.safeParse(row.record);
  if (!parsed.success) return null;
  return {
    record: parsed.data,
    updatedAt: row.updatedAt,
    campNotifiedAt: row.campNotifiedAt,
    wranglerNotifiedAt: row.wranglerNotifiedAt,
  };
}

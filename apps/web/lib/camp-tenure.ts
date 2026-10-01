import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { classifyCampTenure } from "@quagga/core";
import type { CampTenure } from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema } from "./db";

/**
 * NEW TO THE CAMP vs RETURNING, for every CURRENT member of one camp, relative
 * to one edition (epic #54). The rule is @quagga/core `classifyCampTenure`;
 * this only loads the camp-held facts it reads — when the membership began,
 * and which earlier editions it holds logistics for. Never the burner's bio:
 * a bio's camp history is the person's own (and may be private), so it is
 * never used to sort them into an audience.
 *
 * Keyed by membership id. Former (archived) members are not current members
 * and are not returned.
 */
export async function loadCampTenure(
  groupId: string,
  editionId: string,
): Promise<Map<string, CampTenure>> {
  const [target] = await db()
    .select({ year: schema.editions.year })
    .from(schema.editions)
    .where(eq(schema.editions.id, editionId))
    .limit(1);
  const out = new Map<string, CampTenure>();
  if (!target) return out;

  const editions = await db()
    .select({ year: schema.editions.year, endDate: schema.editions.endDate })
    .from(schema.editions);

  const members = await db()
    .select({
      membershipId: schema.memberships.id,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), activeMembership()));
  if (members.length === 0) return out;

  const logistics = await db()
    .select({
      membershipId: schema.membershipLogistics.membershipId,
      year: schema.editions.year,
    })
    .from(schema.membershipLogistics)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.membershipLogistics.editionId),
    )
    .where(
      inArray(
        schema.membershipLogistics.membershipId,
        members.map((m) => m.membershipId),
      ),
    );
  const yearsByMembership = new Map<string, number[]>();
  for (const l of logistics) {
    const years = yearsByMembership.get(l.membershipId) ?? [];
    years.push(l.year);
    yearsByMembership.set(l.membershipId, years);
  }

  for (const m of members) {
    out.set(
      m.membershipId,
      classifyCampTenure(
        {
          membershipCreatedAt: m.createdAt,
          logisticsEditionYears: yearsByMembership.get(m.membershipId) ?? [],
        },
        target,
        editions,
      ),
    );
  }
  return out;
}

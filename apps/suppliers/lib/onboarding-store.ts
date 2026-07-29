import "server-only";

import { and, eq } from "drizzle-orm";
import type { SupplierOnboardingSteps } from "@quagga/types";

import { schema, type Transaction } from "@/lib/db";

/**
 * Read a supplier's stored step map INSIDE the transaction that is about to
 * rewrite it, holding the row until commit.
 *
 * WHY THIS EXISTS. `supplier_onboarding.steps` is a single jsonb column holding
 * ALL SEVEN steps, and every writer persists the whole map. The supplier-side
 * writers built that map from `session.steps` — a value read during session
 * resolution, on a different connection, before the transaction opened. So
 * anything the ORG committed in between was silently overwritten by the
 * supplier's next click: AfrikaBurn marks "Deposit received", the supplier ticks
 * an unrelated document a moment later, and the deposit drops back to "Awaiting
 * AfrikaBurn" — with no audit event anywhere naming the deposit, because as far
 * as the supplier's action was concerned it only touched a document.
 *
 * Reading here, on the same `tx`, closes that window. `FOR UPDATE` closes the
 * much narrower one between this read and the write, so two concurrent writers
 * of the same supplier × edition serialise rather than race.
 *
 * A missing row yields `{}`: the caller's UPDATE then matches nothing, which is
 * the same no-op it has always been (the row is created during session
 * resolution, so this is a defensive floor, not an expected path).
 */
export async function lockOnboardingSteps(
  tx: Transaction,
  supplierId: string,
  editionId: string,
): Promise<SupplierOnboardingSteps> {
  const [row] = await tx
    .select({ steps: schema.supplierOnboarding.steps })
    .from(schema.supplierOnboarding)
    .where(
      and(
        eq(schema.supplierOnboarding.supplierId, supplierId),
        eq(schema.supplierOnboarding.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  return row?.steps ?? {};
}

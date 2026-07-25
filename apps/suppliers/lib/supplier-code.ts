import "server-only";

import { eq, isNotNull } from "drizzle-orm";
import type { Database } from "@quagga/db";
import { issueSupplierCode } from "@quagga/core";

import { schema } from "@/lib/db";

// Issuance of `suppliers.code` (`SUP-2027-0416`). The FORMAT is deterministic
// and pure (@quagga/core `issueSupplierCode`); only the sequence allocation
// needs the database, and that lives here.
//
// CONCURRENCY. The HTTP Drizzle driver has no transactions, so two suppliers
// registering in the same instant can compute the same next sequence. That is
// fine and expected: `suppliers.code` is UNIQUE, so the loser's insert fails and
// we simply recompute and retry. The unique constraint is the arbiter, not a
// read-then-write race we pretend we won. Bounded retries stop a pathological
// contention loop from hanging a request.

const MAX_ATTEMPTS = 5;

/**
 * Assign a code to a supplier that has none. Idempotent: a supplier that already
 * has a code keeps it (codes are quoted off-platform and must never change), and
 * the existing value is returned.
 *
 * Returns null if a code could not be assigned after `MAX_ATTEMPTS` — the caller
 * treats that as non-fatal, because a missing code never blocks onboarding; it
 * is a display and paperwork convenience that can be backfilled.
 */
export async function assignSupplierCode(
  db: Database,
  supplierId: string,
  year: number,
): Promise<string | null> {
  const [existing] = await db
    .select({ code: schema.suppliers.code })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, supplierId))
    .limit(1);
  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const taken = await db
      .select({ code: schema.suppliers.code })
      .from(schema.suppliers)
      .where(isNotNull(schema.suppliers.code));

    const code = issueSupplierCode(
      year,
      taken.map((r) => r.code),
    );

    try {
      const updated = await db
        .update(schema.suppliers)
        .set({ code, updatedAt: new Date() })
        .where(eq(schema.suppliers.id, supplierId))
        .returning({ code: schema.suppliers.code });
      const assigned = updated[0]?.code;
      if (assigned) return assigned;
    } catch {
      // Unique violation — someone took this sequence between our read and our
      // write. Loop and recompute against the now-larger set.
    }
  }
  return null;
}

import "server-only";

import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import {
  deriveOnboardingProgress,
  contactNamesAddress,
  isSanitized,
  type SupplierOnboardingProgress,
} from "@quagga/core";
import type {
  SupplierOnboardingSteps,
  SupplierReturning,
  SupplierStanding,
} from "@quagga/types";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

/** The active edition the onboarding checklist is scoped to. */
export interface PortalEdition {
  id: string;
  name: string;
  year: number;
}

/** A supplier who has signed in and resolved to a supplier row. */
export interface SupplierIdentity {
  id: string;
  name: string;
  /**
   * The human-quotable supplier reference (`SUP-2027-0416`) — the canvas
   * Progress-panel chip (frames `Q4fye`/`lm3jO`, node `D6Xsb`). NULLABLE by
   * design: imported rows predate the scheme and are backfilled lazily, so the
   * portal must render NOTHING for them rather than a placeholder that reads
   * like a real code (`supplierCodeChipValue` in `lib/onboarding-view`).
   */
  code: string | null;
  services: string | null;
  contact: string | null;
  website: string | null;
  category: string | null;
  returning: SupplierReturning | null;
  standing: SupplierStanding;
}

/** A signed-in supplier session, scoped to the active edition. */
export interface SupplierSession {
  user: AuthenticatedUser;
  /** Our `users.id` (the join row) — the audit actor. */
  dbUserId: string;
  supplier: SupplierIdentity;
  edition: PortalEdition;
  /** The stored `supplier_onboarding.steps` map for this supplier × edition. */
  steps: SupplierOnboardingSteps;
  /** Derived n/7 progress over `steps`. */
  progress: SupplierOnboardingProgress;
}

/**
 * Every way the portal gate resolves:
 *  - not signed in / auth unconfigured   → `unauthenticated`
 *  - signed in but DB or edition absent  → `not_ready`
 *  - signed in, no supplier row matched  → `unlinked` (offer the register form)
 *  - signed in, supplier resolved        → `ok`
 */
export type SupplierSessionState =
  | { kind: "unauthenticated" }
  | { kind: "not_ready"; user: AuthenticatedUser }
  | { kind: "unlinked"; user: AuthenticatedUser; dbUserId: string }
  | ({ kind: "ok" } & SupplierSession);

/** The active edition, falling back to the most recent one. */
async function resolveActiveEdition(
  db: ReturnType<typeof getDb>,
): Promise<PortalEdition | null> {
  const cols = {
    id: schema.editions.id,
    name: schema.editions.name,
    year: schema.editions.year,
  };
  const [active] = await db
    .select(cols)
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .limit(1);
  if (active) return active;
  const [latest] = await db
    .select(cols)
    .from(schema.editions)
    .orderBy(desc(schema.editions.year))
    .limit(1);
  return latest ?? null;
}

/**
 * Escape LIKE/ILIKE wildcards (`%`, `_`) and the escape char (`\`) so an
 * interpolated string is matched LITERALLY. Both `%` and `_` are legal
 * email local-part characters (underscore especially common), so without this
 * a verified address like `a_b@x.com` would widen the pattern (`_` matching any
 * single char) beyond the exact address. Backslash is Postgres' default LIKE
 * escape character, so no explicit ESCAPE clause is needed.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Resolve (and, when found by email, link) the supplier row for a signed-in
 * user. Preference order:
 *   1. an existing row already linked by `user_id`;
 *   2. an unlinked row whose free-text `contact` contains the verified email —
 *      claimed by setting `user_id` (the "email overlap links a burner account"
 *      rule). Only VERIFIED emails may claim a row, so an unverified/asserted
 *      email can never hijack an imported supplier.
 * The address must be named as a WHOLE ADDRESS in the contact string, not
 * merely appear inside it. The SQL `ILIKE '%address%'` is now only a cheap
 * prefilter; `contactNamesAddress` (@quagga/core) makes the decision by pulling
 * the email-like tokens out of the free text and comparing them exactly.
 *
 * A substring test here was a takeover. `suppliers.contact` is prose full of
 * webmail addresses, so with `%address%` alone:
 *   contact "Zizipho Gcasamba z.gcasamba@gmail.com"
 *     → register gcasamba@gmail.com, verify it, sign in, own Poswa Logistics
 *   contact "Lenny deharnstretchtents85@gmail.com"
 *     → register harnstretchtents85@gmail.com and own that supplier
 * The shorter address is a literal substring of the longer one, both are
 * ordinary registerable Gmail addresses, and the claim writes `user_id` — which
 * hands over that business's onboarding, documents, standing and the org's
 * internal correspondence about them.
 *
 * Selection stays deterministic (oldest row first) so a repeat sign-in always
 * claims the same row rather than an arbitrary one.
 * Returns null when nothing matches — the caller shows the register form.
 */
async function resolveSupplierForUser(
  db: ReturnType<typeof getDb>,
  dbUserId: string,
  user: AuthenticatedUser,
): Promise<SupplierIdentity | null> {
  const cols = {
    id: schema.suppliers.id,
    name: schema.suppliers.name,
    code: schema.suppliers.code,
    services: schema.suppliers.services,
    contact: schema.suppliers.contact,
    website: schema.suppliers.website,
    category: schema.suppliers.category,
    returning: schema.suppliers.returning,
    standing: schema.suppliers.standing,
  };

  const [linked] = await db
    .select(cols)
    .from(schema.suppliers)
    .where(eq(schema.suppliers.userId, dbUserId))
    .limit(1);
  if (linked) return linked;

  const email = user.primaryEmail?.trim();
  if (!email || !user.emailVerified) return null;

  // Email overlap: a still-unlinked row whose contact NAMES this address.
  //
  // The ILIKE is a prefilter only — it narrows the scan to rows that mention
  // the address somewhere. `contactNamesAddress` then decides, by comparing
  // whole email tokens, so a substring can no longer claim a listing. Bounded
  // at 20 candidates: an address that appears inside more than twenty different
  // suppliers' contact strings is not an identity, it is a red flag.
  const candidates = await db
    .select(cols)
    .from(schema.suppliers)
    .where(
      and(
        isNull(schema.suppliers.userId),
        ilike(schema.suppliers.contact, `%${escapeLikePattern(email)}%`),
      ),
    )
    .orderBy(asc(schema.suppliers.createdAt), asc(schema.suppliers.id))
    .limit(20);
  const candidate = candidates.find((row) =>
    contactNamesAddress(row.contact, email),
  );
  if (!candidate) return null;

  await db
    .update(schema.suppliers)
    .set({ userId: dbUserId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.suppliers.id, candidate.id),
        isNull(schema.suppliers.userId),
      ),
    );
  await writeAuditEvent(db, {
    actorId: dbUserId,
    action: "supplier.link",
    subject: candidate.id,
    meta: { via: "email_overlap", email },
  });
  return candidate;
}

/**
 * Read (or lazily create) the onboarding row for a supplier × edition and
 * return its stored step map. New rows start as `{}` — the derivation treats
 * missing keys as `pending`.
 */
async function ensureOnboardingSteps(
  db: ReturnType<typeof getDb>,
  supplierId: string,
  editionId: string,
): Promise<SupplierOnboardingSteps> {
  await db
    .insert(schema.supplierOnboarding)
    .values({ supplierId, editionId, steps: {} })
    .onConflictDoNothing({
      target: [
        schema.supplierOnboarding.supplierId,
        schema.supplierOnboarding.editionId,
      ],
    });
  const [row] = await db
    .select({ steps: schema.supplierOnboarding.steps })
    .from(schema.supplierOnboarding)
    .where(
      and(
        eq(schema.supplierOnboarding.supplierId, supplierId),
        eq(schema.supplierOnboarding.editionId, editionId),
      ),
    )
    .limit(1);
  return row?.steps ?? {};
}

/**
 * Resolve the current portal session. Ensures the `users` join row exists
 * (idempotent), finds/links the supplier, and loads onboarding progress for the
 * active edition. Never throws — every failure degrades to `not_ready` so the
 * portal stays bootable.
 */
export async function resolveSupplierSession(): Promise<SupplierSessionState> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" };
  if (!isDatabaseConfigured()) return { kind: "not_ready", user };

  try {
    const db = getDb();

    // Ensure the users join row (idempotent). Deliberately NOT onConflictDoUpdate:
    // a sanitized (deleted) account keeps its `users` row with `email` nulled, and
    // clobbering it with the incoming email would un-erase the PII the deletion
    // removed. Sync the email only after the sanitized guard below.
    await db
      .insert(schema.users)
      .values({ authUserId: user.id, email: user.primaryEmail })
      .onConflictDoNothing({ target: schema.users.authUserId });
    const [dbUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.authUserId, user.id))
      .limit(1);
    if (!dbUser) return { kind: "not_ready", user };

    // Re-animation guard: a deleted-and-sanitized account must never resolve to a
    // portal session. The Better Auth identity is already deleted; this stops a
    // stale cookie-cache session (up to 5 min) sneaking through.
    if (isSanitized(dbUser)) return { kind: "unauthenticated" };

    // Keep the email fresh for a live account (never a sanitized one — guarded above).
    if (user.primaryEmail && dbUser.email !== user.primaryEmail) {
      await db
        .update(schema.users)
        .set({ email: user.primaryEmail })
        .where(eq(schema.users.id, dbUser.id));
    }

    const edition = await resolveActiveEdition(db);
    if (!edition) return { kind: "not_ready", user };

    const supplier = await resolveSupplierForUser(db, dbUser.id, user);
    if (!supplier) {
      return { kind: "unlinked", user, dbUserId: dbUser.id };
    }

    const steps = await ensureOnboardingSteps(db, supplier.id, edition.id);
    return {
      kind: "ok",
      user,
      dbUserId: dbUser.id,
      supplier,
      edition,
      steps,
      progress: deriveOnboardingProgress(steps),
    };
  } catch {
    return { kind: "not_ready", user };
  }
}

/**
 * For server actions: resolve and require an `ok` supplier session. Throws a
 * caller-safe Error otherwise (actions catch and surface it). Never trust the
 * client — every mutation re-checks here.
 */
export async function requireSupplierSession(): Promise<SupplierSession> {
  const state = await resolveSupplierSession();
  if (state.kind !== "ok") {
    throw new Error("Sign in as a registered supplier to do that.");
  }
  const { kind: _kind, ...session } = state;
  void _kind;
  return session;
}

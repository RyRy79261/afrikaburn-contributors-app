import "server-only";

import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import {
  deriveOnboardingProgress,
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
 * The verified address is matched as a LITERAL substring (wildcards escaped) and
 * selection is deterministic (oldest row first) so a repeat sign-in always
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

  // Email overlap: a still-unlinked row whose contact mentions this address.
  const [candidate] = await db
    .select(cols)
    .from(schema.suppliers)
    .where(
      and(
        isNull(schema.suppliers.userId),
        ilike(schema.suppliers.contact, `%${escapeLikePattern(email)}%`),
      ),
    )
    .orderBy(asc(schema.suppliers.createdAt), asc(schema.suppliers.id))
    .limit(1);
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

    // Ensure the users join row (idempotent; email kept in sync).
    await db
      .insert(schema.users)
      .values({ authUserId: user.id, email: user.primaryEmail })
      .onConflictDoUpdate({
        target: schema.users.authUserId,
        set: { email: user.primaryEmail },
      });
    const [dbUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.authUserId, user.id))
      .limit(1);
    if (!dbUser) return { kind: "not_ready", user };

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

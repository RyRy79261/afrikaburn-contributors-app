import "server-only";

import { and, asc, desc, eq, ilike, inArray, lt } from "drizzle-orm";
import type { RegistrationStatus } from "@quagga/types";

import { getDb, schema } from "@/lib/db";
import { deriveCohort, type Cohort } from "@/lib/org-logic";

// Data access for the console. Every function is read-only and self-contained;
// mutations live in lib/actions/*. All assume the caller already cleared the
// gate (resolveOrgSession) — these do not re-check auth.

export interface ActiveEdition {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

/** The active edition (seed: AfrikaBurn 2027), or null if none is seeded. */
export async function getActiveEdition(): Promise<ActiveEdition | null> {
  const db = getDb();
  const [edition] = await db
    .select({
      id: schema.editions.id,
      name: schema.editions.name,
      year: schema.editions.year,
      startDate: schema.editions.startDate,
      endDate: schema.editions.endDate,
    })
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .orderBy(desc(schema.editions.year))
    .limit(1);
  return edition ?? null;
}

export interface OverviewCounts {
  edition: ActiveEdition | null;
  registrationsByStatus: Record<RegistrationStatus, number>;
  registrationsTotal: number;
  camps: number;
  suppliers: number;
  pendingPayments: number;
}

const EMPTY_STATUS_COUNTS: Record<RegistrationStatus, number> = {
  draft: 0,
  submitted: 0,
  under_review: 0,
  changes_requested: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
};

/** Overview tiles: registrations by status, camps, suppliers, pending payments. */
export async function getOverviewCounts(): Promise<OverviewCounts> {
  const db = getDb();
  const edition = await getActiveEdition();

  const byStatus: Record<RegistrationStatus, number> = { ...EMPTY_STATUS_COUNTS };
  let registrationsTotal = 0;

  if (edition) {
    const rows = await db
      .select({ status: schema.registrations.status })
      .from(schema.registrations)
      .where(eq(schema.registrations.editionId, edition.id));
    for (const row of rows) {
      byStatus[row.status] += 1;
      registrationsTotal += 1;
    }
  }

  // A "camp" here is any project group (non-org). Persistent, not per-edition.
  const [camps, suppliers, pendingPayments] = await Promise.all([
    db.$count(
      schema.groups,
      inArray(schema.groups.kind, ["theme_camp", "artwork", "mutant_vehicle"]),
    ),
    db.$count(schema.suppliers),
    db.$count(schema.payments, eq(schema.payments.status, "pending")),
  ]);

  return {
    edition,
    registrationsByStatus: byStatus,
    registrationsTotal,
    camps,
    suppliers,
    pendingPayments,
  };
}

export interface AccountRow {
  userId: string;
  email: string | null;
  role: "god" | "org_staff" | null;
  createdAt: Date;
}

/**
 * Search users by email (case-insensitive substring), annotated with their org
 * role. Empty query returns the most recent accounts.
 */
export async function searchAccounts(
  orgGroupId: string,
  query: string,
): Promise<AccountRow[]> {
  const db = getDb();
  const q = query.trim();

  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      role: schema.memberships.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .leftJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.users.id),
        eq(schema.memberships.groupId, orgGroupId),
      ),
    )
    .where(q ? ilike(schema.users.email, `%${q}%`) : undefined)
    .orderBy(desc(schema.users.createdAt))
    .limit(50);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    role: r.role === "god" || r.role === "org_staff" ? r.role : null,
    createdAt: r.createdAt,
  }));
}

export interface RegistrationRow {
  id: string;
  status: RegistrationStatus;
  groupName: string;
  groupKind: string;
  groupSlug: string;
  soundRaw: string | null;
  cohort: Cohort;
  expectedPopulation: number | null;
  submittedAt: Date | null;
  updatedAt: Date;
}

/** All registrations for the active edition, annotated with cohort + sound. */
export async function getRegistrationRows(
  edition: ActiveEdition,
): Promise<RegistrationRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      groupId: schema.registrations.groupId,
      groupName: schema.groups.name,
      groupKind: schema.groups.kind,
      groupSlug: schema.groups.slug,
      soundRaw: schema.registrations.s5AmplifiedMusic,
      expectedPopulation: schema.registrations.s4ExpectedPopulation,
      submittedAt: schema.registrations.submittedAt,
      updatedAt: schema.registrations.updatedAt,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(eq(schema.registrations.editionId, edition.id))
    .orderBy(desc(schema.registrations.updatedAt));

  const priorGroupIds = await getGroupsWithPriorRegistrations(edition.year);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    groupName: r.groupName,
    groupKind: r.groupKind,
    groupSlug: r.groupSlug,
    soundRaw: r.soundRaw,
    cohort: deriveCohort(priorGroupIds.has(r.groupId)),
    expectedPopulation: r.expectedPopulation,
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
  }));
}

/** Group ids that registered in an edition PRIOR to `year` (cohort source). */
async function getGroupsWithPriorRegistrations(
  year: number,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ groupId: schema.registrations.groupId })
    .from(schema.registrations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(lt(schema.editions.year, year));
  return new Set(rows.map((r) => r.groupId));
}

export interface SectionReviewRow {
  id: string;
  sectionKey: string;
  status: "open" | "resolved";
  comment: string;
  reviewerEmail: string | null;
  createdAt: Date;
}

export interface SupplierDeclarationRow {
  supplierId: string;
  name: string;
  services: string | null;
  vettingStatus: string;
  note: string | null;
}

export interface RegistrationDetail {
  registration: typeof schema.registrations.$inferSelect;
  group: {
    id: string;
    name: string;
    kind: string;
    slug: string;
    description: string | null;
    joinability: string;
  };
  edition: { id: string; name: string; year: number };
  reviews: SectionReviewRow[];
  supplierDeclarations: SupplierDeclarationRow[];
  decidedByEmail: string | null;
  cohort: Cohort;
}

/** Full read model for one registration detail page. Null if not found. */
export async function getRegistrationDetail(
  id: string,
): Promise<RegistrationDetail | null> {
  const db = getDb();

  const [registration] = await db
    .select()
    .from(schema.registrations)
    .where(eq(schema.registrations.id, id))
    .limit(1);
  if (!registration) return null;

  const [group] = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      kind: schema.groups.kind,
      slug: schema.groups.slug,
      description: schema.groups.description,
      joinability: schema.groups.joinability,
    })
    .from(schema.groups)
    .where(eq(schema.groups.id, registration.groupId))
    .limit(1);

  const [edition] = await db
    .select({
      id: schema.editions.id,
      name: schema.editions.name,
      year: schema.editions.year,
    })
    .from(schema.editions)
    .where(eq(schema.editions.id, registration.editionId))
    .limit(1);

  const reviewer = schema.users;
  const reviews = await db
    .select({
      id: schema.sectionReviews.id,
      sectionKey: schema.sectionReviews.sectionKey,
      status: schema.sectionReviews.status,
      comment: schema.sectionReviews.comment,
      reviewerEmail: reviewer.email,
      createdAt: schema.sectionReviews.createdAt,
    })
    .from(schema.sectionReviews)
    .leftJoin(reviewer, eq(reviewer.id, schema.sectionReviews.reviewerId))
    .where(eq(schema.sectionReviews.registrationId, id))
    .orderBy(asc(schema.sectionReviews.createdAt));

  const supplierDeclarations = await db
    .select({
      supplierId: schema.suppliers.id,
      name: schema.suppliers.name,
      services: schema.suppliers.services,
      vettingStatus: schema.suppliers.vettingStatus,
      note: schema.supplierDeclarations.note,
    })
    .from(schema.supplierDeclarations)
    .innerJoin(
      schema.suppliers,
      eq(schema.suppliers.id, schema.supplierDeclarations.supplierId),
    )
    .where(eq(schema.supplierDeclarations.registrationId, id))
    .orderBy(asc(schema.suppliers.name));

  let decidedByEmail: string | null = null;
  if (registration.decidedByUserId) {
    const [decider] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, registration.decidedByUserId))
      .limit(1);
    decidedByEmail = decider?.email ?? null;
  }

  const prior = group
    ? await getGroupsWithPriorRegistrations(edition?.year ?? 0)
    : new Set<string>();

  return {
    registration,
    group: group ?? {
      id: registration.groupId,
      name: "Unknown group",
      kind: "theme_camp",
      slug: "",
      description: null,
      joinability: "invite_only",
    },
    edition: edition ?? {
      id: registration.editionId,
      name: "Unknown edition",
      year: 0,
    },
    reviews: reviews.map((r) => ({
      id: r.id,
      sectionKey: r.sectionKey,
      status: r.status,
      comment: r.comment,
      reviewerEmail: r.reviewerEmail,
      createdAt: r.createdAt,
    })),
    supplierDeclarations,
    decidedByEmail,
    cohort: deriveCohort(group ? prior.has(group.id) : false),
  };
}

export interface DecisionLogRow {
  id: string;
  action: string;
  actorEmail: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/** Decision history for a registration (audit_events on this subject). */
export async function getRegistrationDecisionLog(
  registrationId: string,
): Promise<DecisionLogRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      actorEmail: schema.users.email,
      meta: schema.auditEvents.meta,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(eq(schema.auditEvents.subject, registrationId))
    .orderBy(desc(schema.auditEvents.createdAt));
  return rows;
}

export type SupplierRow = typeof schema.suppliers.$inferSelect;

/** All suppliers, alphabetical. */
export async function getSuppliers(): Promise<SupplierRow[]> {
  const db = getDb();
  return db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.name));
}

export interface PaymentRow {
  id: string;
  reference: string;
  subjectType: string;
  subjectLabel: string;
  amountCents: number | null;
  currency: string;
  status: "pending" | "reconciled" | "waived";
  createdAt: Date;
}

/** All payment references, newest first, with a best-effort subject label. */
export async function getPayments(): Promise<PaymentRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.payments)
    .orderBy(desc(schema.payments.createdAt));

  const labels = await resolvePaymentSubjectLabels(rows);

  return rows.map((p) => ({
    id: p.id,
    reference: p.reference,
    subjectType: p.subjectType,
    subjectLabel: labels.get(`${p.subjectType}:${p.subjectId}`) ?? p.subjectType,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt,
  }));
}

/** Resolve human labels for polymorphic payment subjects (group / registration). */
async function resolvePaymentSubjectLabels(
  rows: (typeof schema.payments.$inferSelect)[],
): Promise<Map<string, string>> {
  const db = getDb();
  const labels = new Map<string, string>();

  const groupIds = rows
    .filter((r) => r.subjectType === "group")
    .map((r) => r.subjectId);
  const registrationIds = rows
    .filter((r) => r.subjectType === "registration")
    .map((r) => r.subjectId);

  if (groupIds.length > 0) {
    const groups = await db
      .select({ id: schema.groups.id, name: schema.groups.name })
      .from(schema.groups)
      .where(inArray(schema.groups.id, groupIds));
    for (const g of groups) labels.set(`group:${g.id}`, g.name);
  }

  if (registrationIds.length > 0) {
    const regs = await db
      .select({
        id: schema.registrations.id,
        name: schema.groups.name,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .where(inArray(schema.registrations.id, registrationIds));
    for (const r of regs) labels.set(`registration:${r.id}`, r.name);
  }

  return labels;
}

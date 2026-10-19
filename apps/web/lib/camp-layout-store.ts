import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  canEditCampLayout,
  canSeeLayoutWarnings,
  canViewCampLayout,
  checkLayoutAgainstCatalog,
  copyLayoutForNewEdition,
  createEmptyLayoutDocument,
  decideLayoutCreate,
  decideLayoutSave,
  decideStartFromLastYear,
  enforceKindPermissions,
  getLayoutCatalog,
  isRetryOfStoredLayout,
  LAYOUT_AUDIT,
  layoutAvailableForGroup,
  layoutRefusalMessage,
  layoutSnapshotState,
  layoutWarnings,
  plotSummary,
  publicMemberName,
  type LayoutAreaSummary,
  type LayoutRefusal,
  type LayoutSnapshotState,
  type LayoutWarning,
  type PermissionMembership,
} from "@quagga/core";
import {
  countLayoutObjects,
  CreateCampLayoutInput,
  LayoutDocument,
  SaveCampLayoutInput,
  StartLayoutFromLastYearInput,
  type GroupKind,
  type ProjectPermissions,
  type RegistrationStatus,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";
import { getMemberPermissions } from "./roles-store";

// Camp layouts (docs/camp-layout-spec.md). Every rule is a pure @quagga/core
// function (camp-layout.ts, layout-catalog.ts) and the geometry is
// @quagga/geo; this file loads the facts those functions read — from the
// database, never from the request — and performs the writes.
//
// SCOPING. A request names a camp by slug. The caller's membership is
// resolved for that camp (`loadLayoutAccess` for reads, `lockLayoutActor`
// inside every write), and the layout is found through the camp's
// registration for the ACTIVE edition — never by an id from the request.
// Non-members and strangers get null from every read and "Camp not found."
// from every write: the same answer a slug that does not exist gets.
//
// VALIDATION. Every write parses its whole input with the @quagga/types
// schema HERE, then runs the catalogue check, so a caller that forgot to
// validate cannot store a malformed document. Geometry warnings are advice
// and never refuse a save.
//
// RACES. Saves are compare-and-set on `camp_layouts.version`: the UPDATE
// matches on the version the editor loaded, and zero rows is "this layout
// changed since you opened it". A first layout races on the unique
// registration index, and the loser is told one already exists. Pinning a
// snapshot (registration submit) reads the layout `FOR SHARE`, so a save in
// flight commits first and the snapshot is what was saved.
//
// AUDIT. Creating a layout, starting from last year's and pinning a snapshot
// write an `audit_events` row in the same transaction — ids, versions and
// counts only, never a label or a note. Ordinary saves do not: the editor
// saves as you go, like the registration wizard's autosave (which is not
// audited either), and `updated_by_user_id` records who saved last.

export type LayoutResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

/** A failed result carrying the refusal's user-facing sentence. */
function refused(reason: LayoutRefusal): { ok: false; error: string } {
  return { ok: false, error: layoutRefusalMessage(reason) };
}

const INVALID = "That layout couldn't be saved. Reload and try again.";

/** True for a Postgres unique violation (23505), looking up to three `cause`s
 * deep. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** The edition a layout belongs to (the active one). */
export interface LayoutEdition {
  id: string;
  year: number;
}

// --- Access --------------------------------------------------------------------

export interface LayoutCamp {
  id: string;
  name: string;
  slug: string;
}

export interface LayoutAccess {
  camp: LayoutCamp;
  viewerUserId: string;
  membership: PermissionMembership;
  canEdit: boolean;
  canSeeWarnings: boolean;
}

/** The group with this slug, any kind, or null. */
export async function findCamp(
  slug: string,
): Promise<(LayoutCamp & { kind: GroupKind }) | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  return group ?? null;
}

/**
 * The viewer's access to a camp's layout, or null — not a theme camp, not a
 * current member (an archived member is not a member), or no such camp. Every
 * read below takes the result of this, never a slug on its own.
 */
export async function loadLayoutAccess(
  slug: string,
  viewerUserId: string,
): Promise<LayoutAccess | null> {
  const group = await findCamp(slug);
  if (!group || !layoutAvailableForGroup(group.kind)) return null;
  const membership = await getMemberPermissions(group.id, viewerUserId);
  if (!membership || !canViewCampLayout(membership)) return null;
  return {
    camp: { id: group.id, name: group.name, slug: group.slug },
    viewerUserId,
    membership,
    canEdit: canEditCampLayout(membership),
    canSeeWarnings: canSeeLayoutWarnings(membership),
  };
}

// --- Reads -----------------------------------------------------------------------

export interface CampLayoutView {
  edition: LayoutEdition;
  /** Null: the camp has not started its registration for this edition, so
   * there is nowhere for a layout to live yet. */
  registration: { id: string; status: RegistrationStatus } | null;
  layout: {
    id: string;
    document: LayoutDocument;
    version: number;
    updatedAt: Date;
    updatedByName: string | null;
  } | null;
  /** The latest snapshot pinned for AfrikaBurn, if any. */
  snapshot: { version: number; pinnedAt: Date } | null;
  snapshotState: LayoutSnapshotState | null;
  summary: (LayoutAreaSummary & { totalObjectCount: number }) | null;
  /** Null when the viewer may not see warnings (plain members). */
  warnings: LayoutWarning[] | null;
  /** An earlier edition's layout to start from — offered to editors only,
   * and only while this edition has none. */
  lastYear: {
    editionYear: number;
    summary: LayoutAreaSummary & { totalObjectCount: number };
  } | null;
}

/** The camp's layout for the active edition, shaped for the viewer. */
export async function loadCampLayout(
  access: LayoutAccess,
  edition: LayoutEdition,
): Promise<CampLayoutView> {
  const catalog = getLayoutCatalog(edition.year);
  const [registration] = await db()
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
    })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, access.camp.id),
        eq(schema.registrations.editionId, edition.id),
      ),
    )
    .limit(1);

  const empty: CampLayoutView = {
    edition,
    registration: registration ?? null,
    layout: null,
    snapshot: null,
    snapshotState: null,
    summary: null,
    warnings: null,
    lastYear: null,
  };
  if (!registration) return empty;

  const [row] = await db()
    .select({
      id: schema.campLayouts.id,
      document: schema.campLayouts.document,
      version: schema.campLayouts.version,
      updatedAt: schema.campLayouts.updatedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.campLayouts)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.campLayouts.updatedByUserId),
    )
    .where(eq(schema.campLayouts.registrationId, registration.id))
    .limit(1);

  if (!row) {
    return {
      ...empty,
      lastYear: access.canEdit
        ? await findLastYearsLayout(access.camp.id, edition.year, catalog)
        : null,
    };
  }

  const [snap] = await db()
    .select({
      version: schema.campLayoutSnapshots.version,
      pinnedAt: schema.campLayoutSnapshots.pinnedAt,
    })
    .from(schema.campLayoutSnapshots)
    .where(eq(schema.campLayoutSnapshots.registrationId, registration.id))
    .orderBy(desc(schema.campLayoutSnapshots.pinnedAt))
    .limit(1);

  return {
    ...empty,
    layout: {
      id: row.id,
      document: row.document,
      version: row.version,
      updatedAt: row.updatedAt,
      updatedByName:
        row.username === null && row.sanitizedAt === null
          ? null
          : publicMemberName(row.username, { sanitizedAt: row.sanitizedAt }),
    },
    snapshot: snap ?? null,
    snapshotState: layoutSnapshotState(row.version, snap?.version ?? null),
    summary: plotSummary(row.document, catalog),
    warnings: access.canSeeWarnings
      ? layoutWarnings(row.document, catalog)
      : null,
  };
}

/** The most recent EARLIER edition's layout for this camp, newest first. */
async function findLastYearsLayout(
  groupId: string,
  currentYear: number,
  catalog: ReturnType<typeof getLayoutCatalog>,
): Promise<CampLayoutView["lastYear"]> {
  const source = await findLayoutSource(db(), groupId, currentYear);
  if (!source) return null;
  return {
    editionYear: source.editionYear,
    summary: plotSummary(source.document, catalog),
  };
}

type Handle = Tx | ReturnType<typeof db>;

/**
 * The camp's layout from its most recent EARLIER edition, for carrying
 * forward; null when it has none.
 */
async function findLayoutSource(
  handle: Handle,
  groupId: string,
  currentYear: number,
): Promise<{
  layoutId: string;
  registrationId: string;
  editionYear: number;
  document: LayoutDocument;
} | null> {
  const [row] = await handle
    .select({
      layoutId: schema.campLayouts.id,
      registrationId: schema.registrations.id,
      editionYear: schema.editions.year,
      document: schema.campLayouts.document,
    })
    .from(schema.campLayouts)
    .innerJoin(
      schema.registrations,
      eq(schema.registrations.id, schema.campLayouts.registrationId),
    )
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        lt(schema.editions.year, currentYear),
      ),
    )
    .orderBy(desc(schema.editions.year))
    .limit(1);
  return row ?? null;
}

// --- Writes ------------------------------------------------------------------------

export interface LayoutActor {
  userId: string;
  permissions: PermissionMembership;
}

/**
 * The baseline role's permissions plus every role this membership holds with
 * accepted consent, each clamped to what its kind may grant.
 */
async function loadRolePermissions(
  tx: Tx,
  groupId: string,
  membershipId: string,
): Promise<ProjectPermissions[]> {
  const rows = await tx
    .select({
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
      heldBy: schema.memberRoleAssignments.membershipId,
    })
    .from(schema.projectRoles)
    .leftJoin(
      schema.memberRoleAssignments,
      and(
        eq(schema.memberRoleAssignments.projectRoleId, schema.projectRoles.id),
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    )
    .where(eq(schema.projectRoles.groupId, groupId));
  return rows
    .filter((r) => r.kind === "baseline" || r.heldBy !== null)
    .map((r) => enforceKindPermissions(r.kind, r.permissions));
}

/**
 * The caller's ACTIVE membership of this camp, held `FOR SHARE` with their
 * users row — so an archive, a demotion or an account erasure that committed
 * first is what this sees — and their permissions as of now. Null when not a
 * current member, erased, or the camp is not a theme camp.
 */
export async function lockLayoutActor(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<LayoutActor | null> {
  const [row] = await tx
    .select({
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      groupKind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, userId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1)
    .for("share", { of: [schema.memberships, schema.users] });
  if (!row || !layoutAvailableForGroup(row.groupKind)) return null;
  const rolePermissions = await loadRolePermissions(
    tx,
    groupId,
    row.membershipId,
  );
  return {
    userId,
    permissions: { structuralRole: row.role, rolePermissions },
  };
}

/** The registration for this camp and edition, if it exists. */
async function registrationFor(
  tx: Tx,
  groupId: string,
  editionId: string,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: schema.registrations.id })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The registration's layout row, locked `FOR UPDATE`; null when it has
 * none. */
async function layoutFor(
  tx: Tx,
  registrationId: string,
): Promise<{ id: string; version: number; document: LayoutDocument } | null> {
  const [row] = await tx
    .select({
      id: schema.campLayouts.id,
      version: schema.campLayouts.version,
      document: schema.campLayouts.document,
    })
    .from(schema.campLayouts)
    .where(eq(schema.campLayouts.registrationId, registrationId))
    .limit(1)
    .for("update");
  return row ?? null;
}

/**
 * Writes one layout `audit_events` row in the caller's transaction. `meta`
 * holds ids, versions and counts only.
 */
async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  registrationId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    subject: registrationId,
    meta: { registrationId, ...meta },
  });
}

/** Shared front half of every write: parse, find the camp, open the tx,
 * lock the actor, resolve the registration. */
async function withLayoutWrite<T>(
  slug: string,
  viewerUserId: string,
  edition: LayoutEdition,
  fn: (
    tx: Tx,
    ctx: {
      actor: LayoutActor;
      registration: { id: string } | null;
      camp: LayoutCamp;
    },
  ) => Promise<LayoutResult<T>>,
): Promise<LayoutResult<T>> {
  const camp = await findCamp(slug);
  if (!camp) return refused("not_found");
  try {
    return await withTransaction(async (tx) => {
      const actor = await lockLayoutActor(tx, camp.id, viewerUserId);
      if (!actor) return refused("not_found");
      const registration = await registrationFor(tx, camp.id, edition.id);
      return fn(tx, { actor, registration, camp });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return refused("layout_exists");
    throw err;
  }
}

/** "Start with an empty plot": a layout of the size the camp typed. */
export async function createCampLayout(
  viewerUserId: string,
  edition: LayoutEdition,
  raw: unknown,
): Promise<LayoutResult<{ version: number }>> {
  const parsed = CreateCampLayoutInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const { slug, width, depth } = parsed.data;
  return withLayoutWrite(slug, viewerUserId, edition, async (tx, ctx) => {
    const existing = ctx.registration
      ? await layoutFor(tx, ctx.registration.id)
      : null;
    const refusal = decideLayoutCreate({
      canEdit: canEditCampLayout(ctx.actor.permissions),
      hasRegistration: ctx.registration !== null,
      hasLayout: existing !== null,
    });
    if (refusal || !ctx.registration)
      return refused(refusal ?? "no_registration");
    const [row] = await tx
      .insert(schema.campLayouts)
      .values({
        registrationId: ctx.registration.id,
        document: createEmptyLayoutDocument(width, depth),
        version: 1,
        createdByUserId: viewerUserId,
        updatedByUserId: viewerUserId,
      })
      .returning({ id: schema.campLayouts.id });
    await audit(tx, viewerUserId, LAYOUT_AUDIT.create, ctx.registration.id, {
      layoutId: row?.id ?? null,
      width,
      depth,
    });
    return { ok: true, version: 1 };
  });
}

/** "Start from last year's layout" — one click, a copy, never automatic and
 * never over an existing layout (spec decision 12). */
export async function startLayoutFromLastYear(
  viewerUserId: string,
  edition: LayoutEdition,
  raw: unknown,
): Promise<LayoutResult<{ version: number }>> {
  const parsed = StartLayoutFromLastYearInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  return withLayoutWrite(
    parsed.data.slug,
    viewerUserId,
    edition,
    async (tx, ctx) => {
      const existing = ctx.registration
        ? await layoutFor(tx, ctx.registration.id)
        : null;
      const source = await findLayoutSource(tx, ctx.camp.id, edition.year);
      const refusal = decideStartFromLastYear({
        canEdit: canEditCampLayout(ctx.actor.permissions),
        hasRegistration: ctx.registration !== null,
        hasLayout: existing !== null,
        hasSource: source !== null,
      });
      if (refusal || !ctx.registration || !source) {
        return refused(refusal ?? "no_source");
      }
      // Last year's document went through last year's validation; it must
      // pass THIS year's before it becomes this year's plan.
      const stored = LayoutDocument.safeParse(source.document);
      if (!stored.success) return refused("no_source");
      const document = copyLayoutForNewEdition(stored.data, randomUUID);
      const valid = LayoutDocument.safeParse(document);
      if (!valid.success) return refused("no_source");
      const offCatalog = checkLayoutAgainstCatalog(
        valid.data,
        getLayoutCatalog(edition.year),
      );
      if (offCatalog) return refused(offCatalog.reason);

      const [row] = await tx
        .insert(schema.campLayouts)
        .values({
          registrationId: ctx.registration.id,
          document: valid.data,
          version: 1,
          createdByUserId: viewerUserId,
          updatedByUserId: viewerUserId,
        })
        .returning({ id: schema.campLayouts.id });
      await audit(
        tx,
        viewerUserId,
        LAYOUT_AUDIT.carryForward,
        ctx.registration.id,
        {
          layoutId: row?.id ?? null,
          fromLayoutId: source.layoutId,
          fromRegistrationId: source.registrationId,
          fromEditionYear: source.editionYear,
          objects: countLayoutObjects(valid.data.plot),
        },
      );
      return { ok: true, version: 1 };
    },
  );
}

/** Save the working document: compare-and-set on the version it was made
 * from. Warnings never refuse; a malformed or off-catalogue document does. */
export async function saveCampLayout(
  viewerUserId: string,
  edition: LayoutEdition,
  raw: unknown,
): Promise<LayoutResult<{ version: number }>> {
  const parsed = SaveCampLayoutInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const { slug, expectedVersion, document } = parsed.data;
  const offCatalog = checkLayoutAgainstCatalog(
    document,
    getLayoutCatalog(edition.year),
  );
  if (offCatalog) return refused(offCatalog.reason);

  return withLayoutWrite(slug, viewerUserId, edition, async (tx, ctx) => {
    const current = ctx.registration
      ? await layoutFor(tx, ctx.registration.id)
      : null;
    const refusal = decideLayoutSave({
      canEdit: canEditCampLayout(ctx.actor.permissions),
      currentVersion: current?.version ?? null,
      expectedVersion,
    });
    // The retry of a save that committed but whose response was lost:
    // the stored document is exactly what was sent, so it IS saved.
    if (
      refusal === "stale" &&
      current &&
      isRetryOfStoredLayout({
        currentVersion: current.version,
        expectedVersion,
        current: current.document,
        sent: document,
      })
    ) {
      return { ok: true, version: current.version };
    }
    if (refusal || !current) return refused(refusal ?? "no_layout");
    const updated = await tx
      .update(schema.campLayouts)
      .set({
        document,
        version: expectedVersion + 1,
        updatedByUserId: viewerUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.campLayouts.id, current.id),
          eq(schema.campLayouts.version, expectedVersion),
        ),
      )
      .returning({ version: schema.campLayouts.version });
    if (updated.length === 0) return refused("stale");
    return { ok: true, version: expectedVersion + 1 };
  });
}

/** Whether this registration has a layout drawn — the registration wizard's
 * "From your layout" (decision 11). Not an authz boundary: callers have
 * already decided the caller may see the registration. */
export async function registrationHasLayout(
  registrationId: string,
): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.campLayouts.id })
    .from(schema.campLayouts)
    .where(eq(schema.campLayouts.registrationId, registrationId))
    .limit(1);
  return Boolean(row);
}

// --- Pinning (called from the registration submit) -----------------------------

/**
 * Pin the camp's current layout for AfrikaBurn, inside the transaction that
 * moves the registration to `submitted` (spec decision 9). Nothing to pin
 * when the camp drew no layout — an upload or nothing is still a valid
 * submission. Append-only: a resubmit adds a snapshot, never replaces one.
 * Returns the pinned version, or null.
 */
export async function pinLayoutSnapshot(
  tx: Tx,
  input: {
    registrationId: string;
    submittedAt: Date;
    actorUserId: string | null;
  },
): Promise<number | null> {
  const [layout] = await tx
    .select({
      id: schema.campLayouts.id,
      version: schema.campLayouts.version,
      document: schema.campLayouts.document,
    })
    .from(schema.campLayouts)
    .where(eq(schema.campLayouts.registrationId, input.registrationId))
    .limit(1)
    .for("share");
  if (!layout) return null;
  await tx.insert(schema.campLayoutSnapshots).values({
    layoutId: layout.id,
    registrationId: input.registrationId,
    version: layout.version,
    document: layout.document,
    registrationSubmittedAt: input.submittedAt,
    pinnedAt: input.submittedAt,
    pinnedByUserId: input.actorUserId,
  });
  await tx.insert(schema.auditEvents).values({
    actorId: input.actorUserId,
    action: LAYOUT_AUDIT.pin,
    subject: input.registrationId,
    meta: {
      registrationId: input.registrationId,
      layoutId: layout.id,
      version: layout.version,
    },
  });
  return layout.version;
}

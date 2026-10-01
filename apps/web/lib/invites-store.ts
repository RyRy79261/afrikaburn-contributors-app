import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  canRedeemInviteAs,
  inviteRejectionMessage,
  MEMBER_RESTORE_AUDIT_ACTION,
  type InviteLike,
} from "@quagga/core";
import type { InviteKind } from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction, type Tx } from "./db";
import {
  getViewerRole,
  ensureMembershipWithRefCode,
  isFormerMember,
} from "./groups-store";
import {
  clearShiftsOnRestore,
  dropRoleAssignmentsOnRestore,
} from "./member-archive-store";

export interface InviteRow {
  id: string;
  token: string;
  kind: InviteKind;
  expiresAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Mint a one-time invite for a group. Default validity 30 days. */
export async function createInvite(input: {
  groupId: string;
  createdByUserId: string;
  kind: InviteKind;
  ttlDays?: number;
}): Promise<InviteRow> {
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? 30) * 24 * 60 * 60 * 1000,
  );
  const rows = await db()
    .insert(schema.invites)
    .values({
      groupId: input.groupId,
      token: newToken(),
      kind: input.kind,
      createdByUserId: input.createdByUserId,
      expiresAt,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to mint invite");
  return {
    id: row.id,
    token: row.token,
    kind: row.kind,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

/** Revoke an unused invite by stamping it used (so it can never be redeemed). */
export async function revokeInvite(
  inviteId: string,
  groupId: string,
): Promise<void> {
  await db()
    .update(schema.invites)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.invites.id, inviteId),
        eq(schema.invites.groupId, groupId),
        isNull(schema.invites.usedAt),
      ),
    );
}

/** Active (unused, unexpired-or-not) invites for a group, newest first. */
export async function listInvites(groupId: string): Promise<InviteRow[]> {
  const rows = await db()
    .select()
    .from(schema.invites)
    .where(
      and(eq(schema.invites.groupId, groupId), isNull(schema.invites.usedAt)),
    )
    .orderBy(desc(schema.invites.createdAt));
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    kind: row.kind,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  }));
}

export interface InvitePreview {
  token: string;
  kind: InviteKind;
  /** The invited group — needed to resolve the viewer's existing membership. */
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupDescription: string | null;
  /** Display name of whoever minted the link (edition-scoped); null if unknown. */
  inviterName: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  /** Set once a redeemer has claimed the link (single-use, with `usedAt`). */
  usedByUserId: string | null;
  /** Whether the camp is registered (approved) for the passed edition. */
  registered: boolean;
}

/** The `@quagga/core` redemption shape carried by a preview row. */
export function previewAsInviteLike(preview: InvitePreview): InviteLike {
  return {
    kind: preview.kind,
    expiresAt: preview.expiresAt,
    usedAt: preview.usedAt,
    usedByUserId: preview.usedByUserId,
  };
}

/**
 * Look up an invite + its group for the redemption landing page. Pass the active
 * `editionId` to also resolve the inviter's username and the camp's
 * registration badge (both edition-scoped); the used/expired state is derived by
 * the caller from `usedAt` / `expiresAt`.
 */
export async function getInvitePreview(
  token: string,
  editionId?: string,
): Promise<InvitePreview | null> {
  const rows = await db()
    .select({
      token: schema.invites.token,
      kind: schema.invites.kind,
      groupId: schema.groups.id,
      groupName: schema.groups.name,
      groupSlug: schema.groups.slug,
      groupDescription: schema.groups.description,
      expiresAt: schema.invites.expiresAt,
      usedAt: schema.invites.usedAt,
      usedByUserId: schema.invites.usedByUserId,
      createdByUserId: schema.invites.createdByUserId,
    })
    .from(schema.invites)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.invites.groupId))
    .where(eq(schema.invites.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let inviterName: string | null = null;
  let registered = false;
  if (editionId) {
    const approved = await db()
      .select({ id: schema.registrations.id })
      .from(schema.registrations)
      .where(
        and(
          eq(schema.registrations.groupId, row.groupId),
          eq(schema.registrations.editionId, editionId),
          eq(schema.registrations.status, "approved"),
        ),
      )
      .limit(1);
    registered = approved.length > 0;

    if (row.createdByUserId) {
      // This card is the most widely-shared surface in the app: the invite link
      // is meant to be forwarded, so anyone holding it — signed out, unknown to
      // us — reads whatever we put here. Only the USERNAME is safe to put on it.
      // It is a public handle by construction (unique, no privacy toggle, see
      // @quagga/core `username.ts`), so unlike the per-edition display name it
      // replaced there is no flag to consult; and a burner with no handle simply
      // gets no name on the card. What must NEVER appear here is a legal name or
      // an email — the page's "{name} invited you" block is conditional on this
      // being non-null, so the card just drops that line instead.
      const inviter = await db()
        .select({
          username: schema.users.username,
          sanitizedAt: schema.users.sanitizedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, row.createdByUserId))
        .limit(1);
      const handle = inviter[0]?.sanitizedAt
        ? null
        : inviter[0]?.username?.trim() || null;
      inviterName = handle;
    }
  }

  return {
    token: row.token,
    kind: row.kind,
    groupId: row.groupId,
    groupName: row.groupName,
    groupSlug: row.groupSlug,
    groupDescription: row.groupDescription,
    inviterName,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    usedByUserId: row.usedByUserId,
    registered,
  };
}

export type RedeemResult =
  { ok: true; slug: string } | { ok: false; error: string };

/**
 * Redeem a one-time invite for a user. Single-use is enforced twice: the pure
 * {@link canRedeemInviteAs} predicate, then an atomic conditional UPDATE
 * (`used_at IS NULL`) that claims the row — so a race between two redeemers
 * yields exactly one winner. `member` invites add a member; `lead_transfer`
 * hands the lead role to the redeemer and demotes the prior lead(s) to admin.
 */
export async function redeemInvite(
  token: string,
  userId: string,
): Promise<RedeemResult> {
  const inviteRows = await db()
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, token))
    .limit(1);
  const invite = inviteRows[0];
  if (!invite) return { ok: false, error: "This invite link is not valid." };

  const currentRole = await getViewerRole(userId, invite.groupId);
  // A FORMER member (CDB-036) reads as not a member above, so their invite
  // proceeds — and `ensureMembershipWithRefCode` restores their archived row
  // rather than creating a second one. This read only gates the
  // own-invite refusal below; whether a restore HAPPENED (and so the role
  // drop and the audit) is decided inside the transaction, from the write.
  const restoringFormer =
    currentRole === null && (await isFormerMember(userId, invite.groupId));
  const check = canRedeemInviteAs(
    {
      kind: invite.kind,
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt,
      usedByUserId: invite.usedByUserId,
    },
    { isMember: currentRole !== null },
  );
  if (!check.ok && check.reason) {
    // A self_member redeeming a plain member invite: already in — send them in.
    if (check.reason === "self_member") {
      const g = await groupNameAndSlug(invite.groupId);
      return g
        ? { ok: true, slug: g.slug }
        : { ok: false, error: "Camp not found." };
    }
    return { ok: false, error: inviteRejectionMessage(check.reason) };
  }

  // A former member may not let THEMSELVES back in with a link they minted
  // while they were still in the camp. Archiving revokes those links
  // (member-archive-store `archiveMember`); this is the second door, for a
  // link that somehow survived — an invite restores access only when someone
  // with standing in the camp chose to send it.
  if (restoringFormer && invite.createdByUserId === userId) {
    return { ok: false, error: OWN_INVITE_AFTER_ARCHIVE };
  }

  const group = await groupNameAndSlug(invite.groupId);
  if (!group) return { ok: false, error: "Camp not found." };

  // The claim + the membership change are ONE transaction: an invite whose
  // `used_at` is flipped must always yield the membership it granted, and a
  // failed membership write must roll the claim back so the link stays usable.
  try {
    return await withTransaction((tx) =>
      redeemInTransaction(tx, {
        invite,
        userId,
        currentRole,
        group,
      }),
    );
  } catch (err) {
    // The lead transfer found nobody to hand the lead to — the transaction
    // rolled back (the demotion AND the claim), so the link stays usable.
    if (err instanceof LeadTransferLost) {
      return { ok: false, error: LEAD_TRANSFER_LOST };
    }
    // The camp's lead changed underneath (or a concurrent transfer won) —
    // rolled back whole, link still unused.
    if (err instanceof LeadTransferStale) {
      return { ok: false, error: LEAD_TRANSFER_STALE };
    }
    throw err;
  }
}

const OWN_INVITE_AFTER_ARCHIVE =
  "You can't use an invite you created to rejoin this camp — ask a camp lead for one.";

const LEAD_TRANSFER_LOST =
  "Your membership of this camp changed while the lead was being handed over — nothing was changed. Try the link again.";

const LEAD_TRANSFER_STALE =
  "The camp's lead changed while this handover was being accepted — nothing was changed. Try the link again, or ask the current lead for a new one.";

/** Thrown inside the redeem transaction when, with the camp's lead row(s)
 * locked, the camp does not have exactly one lead or that lead is not the
 * person who minted the transfer. Rolls the whole redeem back. */
class LeadTransferStale extends Error {
  constructor() {
    super("lead transfer: the camp's lead is no longer the one who offered it");
  }
}

/** Thrown inside the redeem transaction to roll it back when a lead transfer
 * would otherwise commit with the old lead demoted and no new one. */
class LeadTransferLost extends Error {
  constructor() {
    super("lead transfer: the redeemer's membership row was not promoted");
  }
}

async function redeemInTransaction(
  tx: Tx,
  input: {
    invite: typeof schema.invites.$inferSelect;
    userId: string;
    currentRole: string | null;
    group: { name: string; slug: string };
  },
): Promise<RedeemResult> {
  const { invite, userId, currentRole, group } = input;
  // Set only when THIS transaction's upsert brought an archived row back.
  let restored = false;
  // Atomic claim — only one caller can flip used_at from NULL. If another
  // redeemer already won the race, no rows return and we abort with nothing
  // written (the transaction commits an empty change).
  const claimed = await tx
    .update(schema.invites)
    .set({ usedByUserId: userId, usedAt: new Date() })
    .where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.usedAt)))
    .returning({ id: schema.invites.id });
  if (!claimed[0]) {
    return { ok: false, error: inviteRejectionMessage("already_used") };
  }

  if (invite.kind === "lead_transfer") {
    // SERIALISE LEAD TRANSFERS PER CAMP. Two DIFFERENT lead-transfer links for
    // the same camp redeemed at the same moment used to both succeed: each
    // transaction's demotion matched only the lead IT saw (the old one), so
    // neither demoted the other's newly promoted redeemer — two leads.
    //
    // Lock the camp's current lead row(s) before touching them. A concurrent
    // transfer blocks here until this one commits; Postgres then re-checks
    // the locked row, which is no longer a lead, so the loser reads NO lead
    // (or, if it started after the commit, the NEW lead) and fails the check
    // below. The check itself: exactly one lead, and it is the person who
    // offered the handover (only the lead may mint a lead transfer). If the
    // lead has changed since, this link's handover no longer exists — roll
    // back (the claim included) rather than take the lead from someone the
    // minter never had it from.
    const leads = await tx
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, invite.groupId),
          eq(schema.memberships.role, "lead"),
          activeMembership(),
        ),
      )
      .for("update");
    if (leads.length !== 1 || leads[0]!.userId !== invite.createdByUserId) {
      throw new LeadTransferStale();
    }
    // Demote the (locked) lead to admin, then make the redeemer the lead.
    await tx
      .update(schema.memberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(schema.memberships.groupId, invite.groupId),
          eq(schema.memberships.role, "lead"),
          activeMembership(),
        ),
      );
    // `currentRole` was read BEFORE this transaction. If the redeemer was
    // archived (or left) in between, the promotion below matches no row —
    // and committing then would leave the camp with its lead demoted and no
    // lead at all, which the no-lockout rule forbids. So the promotion must
    // be SEEN to land, or the whole transaction (demotion and claim
    // included) rolls back.
    if (currentRole) {
      // Already a member (keeps their existing ref code) — just take the lead.
      const promoted = await tx
        .update(schema.memberships)
        .set({ role: "lead" })
        .where(
          and(
            eq(schema.memberships.groupId, invite.groupId),
            eq(schema.memberships.userId, userId),
            activeMembership(),
          ),
        )
        .returning({ id: schema.memberships.id });
      if (!promoted[0]) throw new LeadTransferLost();
    } else {
      restored =
        (await ensureMembershipWithRefCode(tx, {
          userId,
          groupId: invite.groupId,
          groupName: group.name,
          role: "lead",
        })) === "restored";
      // The upsert leaves an ACTIVE row it did not expect untouched (someone
      // who joined between the read above and now keeps their own role), so
      // check the row it was meant to produce actually exists.
      const [row] = await tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.groupId, invite.groupId),
            eq(schema.memberships.userId, userId),
            activeMembership(),
          ),
        )
        .limit(1);
      if (row?.role !== "lead") throw new LeadTransferLost();
    }
  } else {
    restored =
      (await ensureMembershipWithRefCode(tx, {
        userId,
        groupId: invite.groupId,
        groupName: group.name,
        role: "member",
      })) === "restored";
  }

  if (restored) {
    // A restored member comes back WITHOUT the custom roles they held
    // (decided 2026-09-28) — the invite grants its structural role and
    // nothing else. The dropped rows are kept in the audit row.
    const dropped = await dropRoleAssignmentsOnRestore(tx, {
      userId,
      groupId: invite.groupId,
    });
    // …and with no camp shifts: nothing left over from before (epic #57).
    await clearShiftsOnRestore(tx, { userId, groupId: invite.groupId });
    await tx.insert(schema.auditEvents).values({
      actorId: userId,
      action: MEMBER_RESTORE_AUDIT_ACTION,
      subject: userId,
      meta: {
        groupId: invite.groupId,
        via: "invite",
        inviteId: invite.id,
        invitedByUserId: invite.createdByUserId,
        role: invite.kind === "lead_transfer" ? "lead" : "member",
        droppedRoleAssignments: dropped,
      },
    });
  }

  return { ok: true, slug: group.slug };
}

async function groupNameAndSlug(
  groupId: string,
): Promise<{ name: string; slug: string } | null> {
  const rows = await db()
    .select({ name: schema.groups.name, slug: schema.groups.slug })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  return rows[0] ?? null;
}

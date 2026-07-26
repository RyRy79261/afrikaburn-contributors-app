import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  canBePublic,
  canRedeemInviteAs,
  inviteRejectionMessage,
  type InviteLike,
} from "@quagga/core";
import type { InviteKind } from "@quagga/types";
import { db, schema, withTransaction } from "./db";
import { getViewerRole, ensureMembershipWithRefCode } from "./groups-store";

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
 * `editionId` to also resolve the inviter's display name and the camp's
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
      const bio = await db()
        .select({
          displayName: schema.burnerBios.displayName,
          privacyFlags: schema.burnerBios.privacyFlags,
        })
        .from(schema.burnerBios)
        .where(
          and(
            eq(schema.burnerBios.userId, row.createdByUserId),
            eq(schema.burnerBios.editionId, editionId),
          ),
        )
        .limit(1);
      // The inviter's display name is a FLAGGABLE field, and this card is the
      // most widely-shared surface in the app: the invite link is meant to be
      // forwarded, so anyone holding it — signed out, unknown to us — reads
      // whatever we put here. Gate it exactly as the public profile does
      // (`publicBioView`): the flag must be explicitly true AND the field must
      // be allowed public at all. An inviter who marked their burner name
      // private gets no name on the card rather than a leak to a group chat;
      // the page's "{name} invited you" block is already conditional on this
      // being non-null, so the card simply drops that line.
      const flags = (bio[0]?.privacyFlags ?? {}) as Record<string, boolean>;
      const namePublic =
        canBePublic("displayName") && flags.displayName === true;
      inviterName = namePublic ? bio[0]?.displayName?.trim() || null : null;
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
  | { ok: true; slug: string }
  | { ok: false; error: string };

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

  const group = await groupNameAndSlug(invite.groupId);
  if (!group) return { ok: false, error: "Camp not found." };

  // The claim + the membership change are ONE transaction: an invite whose
  // `used_at` is flipped must always yield the membership it granted, and a
  // failed membership write must roll the claim back so the link stays usable.
  return withTransaction(async (tx): Promise<RedeemResult> => {
    // Atomic claim — only one caller can flip used_at from NULL. If another
    // redeemer already won the race, no rows return and we abort with nothing
    // written (the transaction commits an empty change).
    const claimed = await tx
      .update(schema.invites)
      .set({ usedByUserId: userId, usedAt: new Date() })
      .where(
        and(eq(schema.invites.id, invite.id), isNull(schema.invites.usedAt)),
      )
      .returning({ id: schema.invites.id });
    if (!claimed[0]) {
      return { ok: false, error: inviteRejectionMessage("already_used") };
    }

    if (invite.kind === "lead_transfer") {
      // Demote existing leads to admin, then make the redeemer the lead.
      await tx
        .update(schema.memberships)
        .set({ role: "admin" })
        .where(
          and(
            eq(schema.memberships.groupId, invite.groupId),
            eq(schema.memberships.role, "lead"),
          ),
        );
      if (currentRole) {
        // Already a member (keeps their existing ref code) — just take the lead.
        await tx
          .update(schema.memberships)
          .set({ role: "lead" })
          .where(
            and(
              eq(schema.memberships.groupId, invite.groupId),
              eq(schema.memberships.userId, userId),
            ),
          );
      } else {
        await ensureMembershipWithRefCode(tx, {
          userId,
          groupId: invite.groupId,
          groupName: group.name,
          role: "lead",
        });
      }
    } else {
      await ensureMembershipWithRefCode(tx, {
        userId,
        groupId: invite.groupId,
        groupName: group.name,
        role: "member",
      });
    }

    return { ok: true, slug: group.slug };
  });
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

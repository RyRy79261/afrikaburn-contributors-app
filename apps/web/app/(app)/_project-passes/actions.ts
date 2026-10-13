"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { wapPassesPath } from "@quagga/core";
import {
  WapAllocateInput,
  WapOverrideInput,
  WapRemoveInput,
  WapRequestInput,
  WapSubmitInput,
  type GroupKind,
} from "@quagga/types";
import { activeMembership } from "@quagga/db";
import type { z } from "zod";

import { db, schema } from "@/lib/db";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  allocateWorkAccessPass,
  removeWorkAccessPass,
  requestWorkAccessPasses,
  submitWorkAccessPassList,
  updateWorkAccessPass,
  type WapResult,
} from "@/lib/wap-store";

// Work Access Pass actions, the project side (epic #53, docs/wap-spec.md).
// Shared by /camps, /artworks and /vehicles — a pass list belongs to a
// registration, whatever kind of group holds it. Zod at the boundary; every
// request names the project by slug and then only ids. WHO the caller is comes
// from the session; whether they may do it is decided by @quagga/core inside
// the store's transaction, over facts it reads itself under a lock.
//
// NEVER the org group: a participant-app action that resolved the org's slug
// would be one check away from editing AfrikaBurn's own membership.

export type WapActionResult = WapResult;

const NOT_FOUND = "Project not found.";

async function resolve(slug: string): Promise<
  | {
      ok: true;
      groupId: string;
      kind: GroupKind;
      userId: string;
      edition: Edition;
    }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const [group] = await db()
    .select({ id: schema.groups.id, kind: schema.groups.kind })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind === "org") return { ok: false, error: NOT_FOUND };
  // ONE answer for "no such project" and "a project you are not in": anything
  // else tells a stranger a free camp exists at that slug. The store re-checks
  // the membership (and that it may manage passes) under a lock; this read
  // only keeps the answers identical.
  const [member] = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.groupId, group.id),
        eq(schema.memberships.userId, user.id),
        activeMembership(),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, error: NOT_FOUND };
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  return {
    ok: true,
    groupId: group.id,
    kind: group.kind,
    userId: user.id,
    edition,
  };
}

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

function revalidate(slug: string, kind: GroupKind) {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(wapPassesPath(kind, slug));
}

export async function requestPassesAction(
  raw: unknown,
): Promise<WapActionResult> {
  const parsed = WapRequestInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssue(parsed.error, "Check the number of passes."),
    };
  }
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await requestWorkAccessPasses({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    requested: parsed.data.requested,
    reason: parsed.data.reason,
  });
  if (result.ok) revalidate(parsed.data.slug, r.kind);
  return result;
}

export async function allocatePassAction(
  raw: unknown,
): Promise<WapActionResult> {
  const parsed = WapAllocateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Choose a member." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await allocateWorkAccessPass({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    membershipId: parsed.data.membershipId,
  });
  if (result.ok) revalidate(parsed.data.slug, r.kind);
  return result;
}

export async function removePassAction(raw: unknown): Promise<WapActionResult> {
  const parsed = WapRemoveInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That pass isn't on the list any more." };
  }
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await removeWorkAccessPass({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    allocationId: parsed.data.allocationId,
  });
  if (result.ok) revalidate(parsed.data.slug, r.kind);
  return result;
}

export async function updatePassAction(raw: unknown): Promise<WapActionResult> {
  const parsed = WapOverrideInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the pass.") };
  }
  const { slug, allocationId, ...overrides } = parsed.data;
  const r = await resolve(slug);
  if (!r.ok) return r;
  const result = await updateWorkAccessPass({
    actorUserId: r.userId,
    groupId: r.groupId,
    edition: r.edition,
    allocationId,
    overrides,
  });
  if (result.ok) revalidate(slug, r.kind);
  return result;
}

export async function submitPassListAction(
  raw: unknown,
): Promise<WapActionResult> {
  const parsed = WapSubmitInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await submitWorkAccessPassList({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
  });
  if (result.ok) revalidate(parsed.data.slug, r.kind);
  return result;
}

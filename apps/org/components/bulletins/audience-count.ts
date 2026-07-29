"use server";

import { z } from "zod";

import {
  canActivateAudience,
  ORG_RANK_LABELS,
  resolveBulletinAudience,
  type AuthzMembership,
} from "@quagga/core";
import { AudienceSpec } from "@quagga/types";

import { buildAudienceContext } from "@/lib/questionnaires/queries";
import { requireOrgSession, type OrgSession } from "@/lib/session";

// The bulletin composer's LIVE audience count, gated on the BULLETINS domain.
//
// WHY THIS EXISTS RATHER THAN REUSING `previewAudienceCount`: the composer used
// the questionnaire flow's preview action verbatim, and that action gates on
// `{ capability: "read", domain: "questionnaires" }`. Domains resolve to the
// department that owns them, so an author whose role sits in the Bulletins
// department failed the gate on the one screen they are meant to run: the
// "Resolves to ~N …" line never arrived, and the refusal `orgCapabilityRefusal`
// composed named the department that owns QUESTIONNAIRES — a screen they were
// not on and had not asked for. `saveBulletin` gates on `bulletins`, so Publish
// stayed armed the whole time and the only thing they lost was the ability to
// see who they were about to broadcast to.
//
// It is otherwise the same two checks the questionnaire preview makes, against
// the same shared resolver: the console capability, then the core authoring
// predicate. Both are re-run by `saveBulletin` on publish — this is a preview,
// never the security boundary.

const PreviewInput = z.object({
  audience: AudienceSpec,
  editionId: z.string().uuid(),
});

export type BulletinAudienceCountResult =
  { ok: true; count: number } | { ok: false; error: string };

/** The actor's memberships for the core authz predicates: one org membership
 * carrying their org rank. Custom roles are never permissions. */
function authzMemberships(session: OrgSession): AuthzMembership[] {
  return [{ groupId: session.orgGroupId, role: session.role }];
}

/** The refusal for a broadcast, named to the actor's rank so it reads as a rule
 * rather than a glitch. Mirrors `broadcastRefusal` in lib/actions/bulletins.ts,
 * so the preview refuses in the same words the publish would. */
function broadcastRefusal(session: OrgSession): string {
  return session.role === "engineer"
    ? `${ORG_RANK_LABELS.engineer} accounts don't broadcast to burners in AfrikaBurn's name — ask org staff to send it.`
    : "You are not allowed to broadcast to that audience.";
}

/**
 * How many people this bulletin would reach right now: authz-check the actor,
 * load the edition's row sets, and run the pure shared `resolveAudience` (via
 * `resolveBulletinAudience`). One resolver, every consumer.
 */
export async function previewBulletinAudienceCount(
  raw: z.input<typeof PreviewInput>,
): Promise<BulletinAudienceCountResult> {
  try {
    const session = await requireOrgSession({
      capability: "read",
      domain: "bulletins",
    });
    const input = PreviewInput.parse(raw);

    // Bulletins broadcast to org audiences; a single camp is a camp-scoped
    // questionnaire, authored from the camp dashboard. `saveBulletin` says the
    // same thing, in the same words.
    if (input.audience.kind === "project") {
      throw new Error(
        "Bulletins broadcast to org audiences, not a single camp.",
      );
    }
    if (
      !canActivateAudience(
        authzMemberships(session),
        input.audience,
        session.orgGroupId,
      )
    ) {
      throw new Error(broadcastRefusal(session));
    }

    const ctx = await buildAudienceContext(input.editionId, session.orgGroupId);
    return {
      ok: true,
      count: resolveBulletinAudience(input.audience, ctx).length,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not resolve the audience.",
    };
  }
}

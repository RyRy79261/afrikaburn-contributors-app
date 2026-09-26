import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, CheckCircle2, ExternalLink, Pin } from "lucide-react";
import { z } from "zod";
import { INVITE_RESUME_PATH, announcementPath } from "@quagga/core";
import {
  ORG_OUTBOUND_SELECTOR_LABELS,
  OFFICER_AUDIENCE_LABELS,
  type AudienceSpec,
} from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser, enforceGate } from "@/lib/session";
import { getBulletinForCurrentUser } from "@/lib/bulletins";
import { markAnnouncementRead } from "@/lib/announcement-gate";
import { readPendingInvite } from "@/lib/pending-invite";
import { db, schema } from "@/lib/db";
import { PreviewNotice } from "@/components/preview-notice";
import { AcknowledgeGate } from "@/components/announcements/acknowledge-gate";
import { acknowledgeAnnouncementAction } from "./actions";

// /bulletins/[id] — the standalone, deep-linkable bulletin page (canvas `R6l2G`
// desktop / `d7HlH` mobile). A bulletin is readable ONLY by a participant who
// was in its audience; `getBulletinForCurrentUser` enforces that server-side
// (it requires a notification row for this user and this bulletin), so an
// org-internal or untargeted broadcast 404s rather than leaking.
//
// CAMP ANNOUNCEMENTS (epic #56) use this same page. A must-acknowledge one that
// the reader has not yet acknowledged IS the gate: the session gate routes
// every other surface here, the shell strips its nav, and the tick box is the
// only way forward (sign-out being the only other reachable action).

export const dynamic = "force-dynamic";

const BulletinId = z.string().uuid();

/**
 * Audience chip copy. The spec's audience machinery is shared with
 * questionnaires; participants only ever see outbound/officer/project shapes
 * here because org-internal broadcasts can't reach this page at all.
 */
function audienceChipLabel(spec: AudienceSpec | null): string | null {
  if (!spec) return null;
  switch (spec.kind) {
    case "org_outbound":
      return spec.selectors
        .map((s) => ORG_OUTBOUND_SELECTOR_LABELS[s] ?? s)
        .join(", ");
    case "org_officer":
      return spec.officerKeys
        .map((k) => OFFICER_AUDIENCE_LABELS[k] ?? k)
        .join(", ");
    case "project":
      return "Your camp";
    case "org_suppliers":
      // Supplier broadcasts never reach a burner's bulletin page (they target
      // supplier accounts), but the label keeps the switch exhaustive.
      return "Suppliers";
    case "org_internal":
      return null;
  }
}

function formatPublished(at: Date | null): string {
  if (!at) return "Unpublished";
  return `Published ${at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export default async function BulletinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Bulletins" />;
  }

  const user = await requireCampUser();

  // Zod at the boundary: a non-uuid path segment is a 404, never a query.
  const { id } = await params;
  const parsed = BulletinId.safeParse(id);
  if (!parsed.success) notFound();

  // The app-wide hard gate outranks reading a bulletin — unless THIS page is
  // the gate (a must-acknowledge announcement), in which case it renders.
  await enforceGate(user.id, announcementPath(parsed.data));

  const bulletin = await getBulletinForCurrentUser(parsed.data);
  if (!bulletin) notFound();

  // Opening it is reading it — the author's read count counts exactly this.
  await markAnnouncementRead({ userId: user.id, bulletinId: bulletin.id });

  // Audience is display-only chrome; the read itself was already authorised
  // above, so this is a plain projection of the same row.
  const [audienceRow] = await db()
    .select({ audience: schema.bulletins.audience })
    .from(schema.bulletins)
    .where(eq(schema.bulletins.id, bulletin.id))
    .limit(1);
  const audience = audienceChipLabel(audienceRow?.audience ?? null);

  const fromCamp = bulletin.groupId !== null;
  const kicker = fromCamp
    ? `Announcement · From ${bulletin.campName ?? "your camp"}`
    : "Bulletin · From AfrikaBurn";
  const mustAcknowledge = bulletin.presentation === "acknowledge";
  const gated = mustAcknowledge && bulletin.acknowledgedAt === null;
  // If an invite is waiting behind the gate, clearing it resumes the join —
  // the same resume the blocking questionnaire and the Burner Bio do.
  const afterGate =
    gated && (await readPendingInvite()) ? INVITE_RESUME_PATH : "/directory";

  return (
    <>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {/* No way back while gated: the tick box is the only way forward. */}
        {!gated && (
          <Link
            href="/notifications"
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to notifications
          </Link>
        )}

        <header className="flex flex-col gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
            {kicker}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {bulletin.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <span>{formatPublished(bulletin.publishedAt)}</span>
            {audience && (
              <>
                <span aria-hidden>·</span>
                <Badge variant="outline">{audience}</Badge>
              </>
            )}
            {mustAcknowledge && (
              <>
                <span aria-hidden>·</span>
                <Badge variant="outline">Must acknowledge</Badge>
              </>
            )}
            {bulletin.pinned && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  <Pin className="h-3.5 w-3.5" aria-hidden />
                  Pinned
                </span>
              </>
            )}
          </div>
        </header>

        <hr className="border-border" />

        <MarkdownView value={bulletin.bodyMd} />

        {bulletin.meetingUrl && (
          <Button asChild variant="secondary" className="self-start">
            <a
              href={bulletin.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Join the meeting
            </a>
          </Button>
        )}

        {gated ? (
          <AcknowledgeGate
            announcementId={bulletin.id}
            afterHref={afterGate}
            action={acknowledgeAnnouncementAction}
          />
        ) : mustAcknowledge && bulletin.acknowledgedAt ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            You acknowledged this on{" "}
            {bulletin.acknowledgedAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        ) : null}
      </article>
    </>
  );
}

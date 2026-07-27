import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pin } from "lucide-react";
import { z } from "zod";
import { Badge } from "@quagga/ui/components/badge";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";

import { guardPortal } from "@/lib/gate";
import { getBulletinForSupplier } from "@/lib/notifications";

// /bulletins/[id] — the deep-linkable bulletin page for the supplier portal,
// the destination every bulletin notification in the supplier inbox points at.
//
// It did not exist until 27 Jul 2026. `bulletinNotification` in @quagga/core
// mints an app-relative `/bulletins/<id>` link for EVERY recipient, and the
// suppliers app had no such route — so the whole Bulletins tab in the supplier
// inbox led to a 404 and supplier broadcasts were unreadable in the app they
// were addressed to.
//
// Authorisation is the notification row itself (see getBulletinForSupplier), so
// this page can only ever render a bulletin this supplier was actually sent.

export const dynamic = "force-dynamic";

const BulletinId = z.string().uuid();

function formatPublished(at: Date | null): string {
  if (!at) return "Unpublished";
  return `Published ${at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export default async function SupplierBulletinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardPortal();
  if (!guard.ok) return guard.node;
  const { session } = guard;

  // Zod at the boundary: a non-uuid path segment is a 404, never a query.
  const { id } = await params;
  const parsed = BulletinId.safeParse(id);
  if (!parsed.success) notFound();

  const bulletin = await getBulletinForSupplier(session.dbUserId, parsed.data);
  if (!bulletin) notFound();

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/notifications"
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to notifications
      </Link>

      <header className="flex flex-col gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
          Bulletin · From AfrikaBurn
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {bulletin.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span>{formatPublished(bulletin.publishedAt)}</span>
          <span aria-hidden>·</span>
          <Badge variant="outline">Suppliers</Badge>
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
    </article>
  );
}

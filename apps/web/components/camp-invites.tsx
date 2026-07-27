"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Trash2, UserPlus, Crown } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { toast } from "@quagga/ui/components/toast";
import type { InviteRow } from "@/lib/invites-store";
import type { CreateInviteResult } from "@/app/(app)/camps/[slug]/actions";

interface CampInvitesProps {
  slug: string;
  initialInvites: InviteRow[];
  canLeadTransfer: boolean;
  createAction: (raw: unknown) => Promise<CreateInviteResult>;
  revokeAction: (raw: unknown) => Promise<{ ok: boolean; error?: string }>;
}

function inviteUrl(token: string): string {
  if (typeof window === "undefined") return `/join/${token}`;
  return `${window.location.origin}/join/${token}`;
}

export function CampInvites({
  slug,
  initialInvites,
  canLeadTransfer,
  createAction,
  revokeAction,
}: CampInvitesProps) {
  const router = useRouter();
  const [invites, setInvites] = React.useState<InviteRow[]>(initialInvites);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function create(kind: "member" | "lead_transfer") {
    startTransition(async () => {
      const result = await createAction({ slug, kind });
      if (result.ok) {
        setInvites((prev) => [result.invite, ...prev]);
        toast.success(
          kind === "member"
            ? "Invite link created"
            : "Lead-transfer link created",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function revoke(inviteId: string) {
    startTransition(async () => {
      const result = await revokeAction({ slug, inviteId });
      if (result.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        toast.success("Invite revoked");
        router.refresh();
      } else {
        toast.error(result.error ?? "Couldn't revoke invite");
      }
    });
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy — copy the link manually");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => create("member")}
          disabled={isPending}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          New member invite
        </Button>
        {canLeadTransfer && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => create("lead_transfer")}
            disabled={isPending}
          >
            <Crown className="h-4 w-4" aria-hidden />
            Lead-transfer link
          </Button>
        )}
      </div>

      {invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active invites. Create a one-time link to add someone.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <Badge
                variant={
                  invite.kind === "lead_transfer" ? "warning" : "secondary"
                }
              >
                {invite.kind === "lead_transfer" ? "Lead transfer" : "Member"}
              </Badge>
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {inviteUrl(invite.token)}
              </code>
              <button
                type="button"
                onClick={() => copy(invite.token)}
                aria-label="Copy invite link"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied === invite.token ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => revoke(invite.id)}
                disabled={isPending}
                aria-label="Revoke invite"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

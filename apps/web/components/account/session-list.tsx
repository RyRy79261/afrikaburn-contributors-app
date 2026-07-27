"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Laptop } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { revokeOtherSessions, revokeSession } from "@/lib/account-actions";

// Active sessions (canvas G35eq §"Active sessions"). REAL: session listing and
// revocation are both in the managed Neon Auth server endpoint allowlist, so
// every control here does exactly what it says.
//
// Two honest departures from the canvas mock:
//  1. The mock shows "Cape Town, South Africa". We do not geolocate — the
//     provider gives us an IP address and nothing else — so we show the IP and
//     say that's what it is. An invented city is a security lie: the whole point
//     of this list is "do I recognise this?", and a wrong city defeats it.
//  2. "Sign out everywhere" keeps THIS device signed in (the provider's
//     `revoke-all-sessions` excludes the caller). Signing yourself out while
//     securing your account is a hostile outcome, so the label says so.

export interface SessionView {
  token: string;
  label: string;
  ipAddress: string | null;
  lastSeen: string | null;
  current: boolean;
}

function relative(iso: string | null): string {
  if (!iso) return "Last seen unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Last seen unknown";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busyToken, setBusyToken] = React.useState<string | null>(null);

  function revokeOne(token: string) {
    setBusyToken(token);
    startTransition(async () => {
      const result = await revokeSession({ token });
      if (result.ok) {
        toast.success(result.message ?? "Session ended.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setBusyToken(null);
    });
  }

  function revokeRest() {
    startTransition(async () => {
      const result = await revokeOtherSessions();
      if (result.ok) {
        toast.success(
          result.message ?? "Every other device has been signed out.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          We show the IP address rather than a city — we don&rsquo;t geolocate
          your sessions, and a guessed city would be worse than none.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={revokeRest}
          disabled={pending || others === 0}
        >
          Sign out everywhere else
        </Button>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          We couldn&rsquo;t read your active sessions right now. That means the
          list is unavailable, not that nothing is signed in — try again in a
          moment.
        </p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <li
              key={session.token}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Laptop
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{session.label}</p>
                    {session.current ? (
                      <Badge variant="success">This device</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {session.ipAddress
                      ? `IP ${session.ipAddress}`
                      : "IP not recorded"}{" "}
                    · {relative(session.lastSeen)}
                  </p>
                </div>
              </div>
              {session.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeOne(session.token)}
                  disabled={pending}
                >
                  {busyToken === session.token && pending
                    ? "Ending…"
                    : "Revoke"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import {
  AccountSessions,
  type SessionView,
} from "@quagga/ui/components/account-sessions";
import { revokeOtherSessions, revokeSession } from "@/lib/account-actions";

// This app's wiring for the SHARED active-sessions list (@quagga/ui, roadmap
// M4-21): its own server actions, and a refresh of the server-rendered page
// after any revocation.

export type { SessionView };

export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  return (
    <AccountSessions
      sessions={sessions}
      onRevoke={(token) => revokeSession({ token })}
      onRevokeOthers={revokeOtherSessions}
      onChanged={() => router.refresh()}
    />
  );
}

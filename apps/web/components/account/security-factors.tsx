"use client";

import { useRouter } from "next/navigation";
import { AccountTwoFactor } from "@quagga/ui/components/account-two-factor";
import {
  AccountPasskeys,
  type PasskeyRow,
} from "@quagga/ui/components/account-passkeys";
import { authClient } from "@/lib/auth-client";

// Thin app-side wiring for the SHARED account-security factor cards (the visual
// flow lives in @quagga/ui so all three apps render it identically). This wrapper
// supplies this app's own same-origin `authClient` — which structurally satisfies
// AccountAuthClient — and refreshes the server-rendered page after any change.

export function TwoFactorCard({
  enabled,
  requiresPassword,
}: {
  enabled: boolean;
  requiresPassword: boolean;
}) {
  const router = useRouter();
  return (
    <AccountTwoFactor
      client={authClient}
      enabled={enabled}
      requiresPassword={requiresPassword}
      onChanged={() => router.refresh()}
    />
  );
}

export function PasskeysCard({ passkeys }: { passkeys: PasskeyRow[] }) {
  const router = useRouter();
  return (
    <AccountPasskeys
      client={authClient}
      passkeys={passkeys}
      onChanged={() => router.refresh()}
    />
  );
}

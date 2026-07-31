"use client";

import { useRouter } from "next/navigation";
import {
  AUTH_CAPABILITIES,
  assessPassword,
  capabilityPendingMessage,
  PASSWORD_MIN_LENGTH,
} from "@quagga/core";
import { AccountTwoFactor } from "@quagga/ui/components/account-two-factor";
import {
  AccountPasskeys,
  type PasskeyRow,
} from "@quagga/ui/components/account-passkeys";
import {
  AccountSessions,
  type SessionView,
} from "@quagga/ui/components/account-sessions";
import { AccountSignInMethods } from "@quagga/ui/components/account-sign-in-methods";
import { authClient } from "@/lib/auth-client";
import {
  changePassword,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/actions/account";

// The portal's wiring for the SHARED account components (@quagga/ui, roadmap
// M4-21). Every visual decision lives in the package so all three apps render
// the same flows; what is supplied here is this app's own same-origin
// `authClient`, its own server actions, and its own paths.

export type { SessionView };

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

export function SignInMethods(props: {
  hasPassword: boolean;
  passwordAddedAt: string | null;
  googleEmail: string | null;
  googleLinked: boolean;
  methodCount: number;
}) {
  const router = useRouter();
  const unlinkCap = AUTH_CAPABILITIES.unlinkAccount;
  return (
    <AccountSignInMethods
      {...props}
      securityHref="/account/security"
      unlinkNotice={
        capabilityPendingMessage(unlinkCap) || unlinkCap.userMessage || ""
      }
      passwordMinLength={PASSWORD_MIN_LENGTH}
      assessPassword={assessPassword}
      onChangePassword={changePassword}
      onChanged={() => router.refresh()}
    />
  );
}

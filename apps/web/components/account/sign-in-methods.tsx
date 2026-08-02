"use client";

import { useRouter } from "next/navigation";
import {
  AUTH_CAPABILITIES,
  assessPassword,
  capabilityPendingMessage,
  PASSWORD_MIN_LENGTH,
} from "@quagga/core";
import { AccountSignInMethods } from "@quagga/ui/components/account-sign-in-methods";
import { changePassword } from "@/lib/account-actions";

// This app's wiring for the SHARED sign-in-methods list (@quagga/ui, roadmap
// M4-21): the capability wording resolved from @quagga/core, this app's own
// Security path, and its own change-password action.

export interface SignInMethodsProps {
  hasPassword: boolean;
  /** When the password credential was added, ISO — we do not know when it last CHANGED. */
  passwordAddedAt: string | null;
  googleEmail: string | null;
  googleLinked: boolean;
  /** Total linked methods, for the last-method rule. */
  methodCount: number;
}

export function SignInMethods(props: SignInMethodsProps) {
  const router = useRouter();
  const unlinkCap = AUTH_CAPABILITIES.unlinkAccount;
  return (
    <AccountSignInMethods
      {...props}
      securityHref="/account/security"
      unlinkNotice={capabilityPendingMessage(unlinkCap) || unlinkCap.userMessage || ""}
      passwordMinLength={PASSWORD_MIN_LENGTH}
      assessPassword={assessPassword}
      onChangePassword={changePassword}
      onChanged={() => router.refresh()}
    />
  );
}

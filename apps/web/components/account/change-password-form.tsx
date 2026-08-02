"use client";

import { useRouter } from "next/navigation";
import { assessPassword, PASSWORD_MIN_LENGTH } from "@quagga/core";
import { AccountChangePassword } from "@quagga/ui/components/account-change-password";
import { changePassword } from "@/lib/account-actions";

// This app's wiring for the SHARED change-password form (@quagga/ui, roadmap
// M4-21). The policy handed in is @quagga/core's `assessPassword` — the same
// function the server action enforces, so the courtesy check in the browser and
// the boundary check on the server cannot disagree.

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  return (
    <AccountChangePassword
      minLength={PASSWORD_MIN_LENGTH}
      assess={assessPassword}
      onSubmit={changePassword}
      onDone={onDone}
      onChanged={() => router.refresh()}
    />
  );
}

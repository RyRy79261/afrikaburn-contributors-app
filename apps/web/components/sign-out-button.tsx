"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/** Ends the Neon Auth session and returns to the landing page. */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } catch {
      // Even if the call fails (e.g. unconfigured), fall through to the landing.
    }
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      // KEEPS ITS WORD AT EVERY WIDTH, and the 44px minimum height that makes
      // it a real touch target. Hiding this label below `sm` was tried and
      // reverted: it bought 30px of header width by turning the one destructive
      // control in the chrome into a bare 16px icon — the smallest tap target
      // on the page, guarding the action with the worst consequence if
      // mis-tapped. The width came from the wordmark instead (app-shell.tsx),
      // which costs nobody anything. Measured: 58x44 here, against 16x16.
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      Sign out
    </button>
  );
}

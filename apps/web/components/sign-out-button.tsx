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
      // The label is on the BUTTON, not only in the text, because the text is
      // hidden below `sm` — without this the control loses its accessible name
      // on exactly the screens where it is icon-only.
      aria-label="Sign out"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {/* ICON-ONLY BELOW `sm`, exactly as every NavLink beside it already is.
          This was the one item in the header nav still carrying its word, and
          at 360px it pushed the row 30px past the right edge of the screen —
          the button hung off the side of the phone, and the whole page went
          horizontally scrollable with it. Same treatment, same breakpoint. */}
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}

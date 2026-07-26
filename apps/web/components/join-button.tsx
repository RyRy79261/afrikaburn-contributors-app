"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@quagga/ui/components/button";

/**
 * The invite's primary call-to-action (design frames qhcHh + MttcT).
 *
 * It is the submit button of a plain `<form action={acceptInviteAction}>` — not
 * a fetch-and-route client widget — because the person clicking it is very often
 * SIGNED OUT and about to be carried through sign-up. A server-side redirect is
 * the only thing that reliably survives that journey, and the button keeps
 * working with JavaScript disabled. `useFormStatus` gives the pending label
 * without owning any of the flow.
 */
export function JoinButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Joining…" : label}
    </Button>
  );
}

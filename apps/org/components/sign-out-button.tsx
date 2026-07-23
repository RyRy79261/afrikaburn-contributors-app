"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@quagga/ui/components/button";
import { authClient } from "@/lib/auth-client";

/** Signs out of Neon Auth and returns to the sign-in view. */
export function SignOutButton({
  variant = "ghost",
  size = "sm",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      try {
        await authClient.signOut();
      } finally {
        router.push("/auth/sign-in");
        router.refresh();
      }
    });
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleSignOut}
      disabled={pending}
    >
      <LogOut aria-hidden />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

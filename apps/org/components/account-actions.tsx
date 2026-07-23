"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { setOrgStaffRole } from "@/lib/actions/accounts";

/** Elevate / demote controls for one account. Only rendered for god admins. */
export function AccountActions({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: "god" | "org_staff" | null;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (role === "god") {
    return (
      <span className="text-xs text-muted-foreground">
        Managed via GOD_EMAILS
      </span>
    );
  }
  if (isSelf) {
    return <span className="text-xs text-muted-foreground">You</span>;
  }

  function act(action: "elevate" | "demote") {
    startTransition(async () => {
      const result = await setOrgStaffRole({ userId, action });
      if (result.ok) {
        toast.success(
          action === "elevate"
            ? "Elevated to org staff."
            : "Removed org access.",
        );
        router.refresh();
      } else {
        toast.error("Could not update access", { description: result.error });
      }
    });
  }

  return role === "org_staff" ? (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => act("demote")}
    >
      <ArrowDown aria-hidden />
      Demote
    </Button>
  ) : (
    <Button size="sm" disabled={pending} onClick={() => act("elevate")}>
      <ArrowUp aria-hidden />
      Make org staff
    </Button>
  );
}

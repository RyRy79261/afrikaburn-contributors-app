"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { allocatePassAction } from "@/app/(app)/_project-passes/actions";

// "Choose a member…" + "Add to the list" (canvas W1). The candidates are the
// project's current members not already on the list, computed on the server;
// the action re-checks membership and the cap under the registration lock.

export function AddMemberForm({
  slug,
  candidates,
  hint,
  disabled,
}: {
  slug: string;
  candidates: { membershipId: string; displayName: string }[];
  /** "3 passes left. Only current members of the camp can hold one." */
  hint: string;
  /** No pass left to hand out (or none granted yet). */
  disabled: boolean;
}) {
  const router = useRouter();
  const [membershipId, setMembershipId] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function add() {
    if (!membershipId) return;
    startTransition(async () => {
      const result = await allocatePassAction({ slug, membershipId });
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      const who = candidates.find((c) => c.membershipId === membershipId);
      toast.success(`${who?.displayName ?? "They"} is on the list.`);
      setMembershipId("");
      router.refresh();
    });
  }

  const none = candidates.length === 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center">
      <p className="text-sm font-medium md:hidden">Add a member</p>
      <div className="md:w-72">
        <Select
          value={membershipId}
          onValueChange={setMembershipId}
          disabled={disabled || none || pending}
        >
          <SelectTrigger aria-label="Choose a member">
            <SelectValue
              placeholder={
                none ? "Everyone is on the list" : "Choose a member…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.membershipId} value={c.membershipId}>
                {c.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={add}
        disabled={disabled || pending || !membershipId}
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {pending ? "Adding…" : "Add to the list"}
      </Button>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

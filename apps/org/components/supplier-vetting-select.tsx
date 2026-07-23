"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { VettingStatus, type VettingStatus as VettingStatusT } from "@quagga/types";
import { setSupplierVetting } from "@/lib/actions/suppliers";

const LABELS: Record<VettingStatusT, string> = {
  listed: "Listed",
  registered: "Registered",
  flagged: "Flagged",
};

/** Inline vetting-status editor for a supplier row. */
export function SupplierVettingSelect({
  supplierId,
  value,
}: {
  supplierId: string;
  value: VettingStatusT;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    const parsed = VettingStatus.parse(next);
    startTransition(async () => {
      const result = await setSupplierVetting({
        supplierId,
        vettingStatus: parsed,
      });
      if (result.ok) {
        toast.success(`Marked ${LABELS[parsed].toLowerCase()}.`);
        router.refresh();
      } else {
        toast.error("Could not update vetting", {
          description: result.error,
        });
      }
    });
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[9rem] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VettingStatus.options.map((s) => (
          <SelectItem key={s} value={s}>
            {LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

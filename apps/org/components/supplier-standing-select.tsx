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
import {
  SupplierStanding,
  type SupplierStanding as SupplierStandingT,
} from "@quagga/types";
import { SUPPLIER_STANDINGS, standingLabel } from "@quagga/core";
import { setSupplierStanding } from "@/lib/actions/suppliers";

/**
 * Inline standing editor for a supplier row (good / watch / suspended). The
 * single org verdict — visible to camps via the picker, so a change is
 * consequential and audited server-side.
 */
export function SupplierStandingSelect({
  supplierId,
  value,
}: {
  supplierId: string;
  value: SupplierStandingT;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    const parsed = SupplierStanding.parse(next);
    if (parsed === value) return;
    startTransition(async () => {
      const result = await setSupplierStanding({
        supplierId,
        standing: parsed,
      });
      if (result.ok) {
        toast.success(`Standing set to ${standingLabel(parsed).toLowerCase()}.`);
        router.refresh();
      } else {
        toast.error("Could not update standing", {
          description: result.error,
        });
      }
    });
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[10.5rem] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPLIER_STANDINGS.map((s) => (
          <SelectItem key={s} value={s}>
            {standingLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

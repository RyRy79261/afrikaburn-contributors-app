import { Wallet } from "lucide-react";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

// Parked (Ryan, 24 Jul 2026): AfrikaBurn never receives payments from theme
// camps — registration is free. The payments table stays frozen in the schema
// and the reconcile code paths remain compiling for the future logistics apps
// (containers, water/ice/gas), but there is nothing to track here today.
export default async function PaymentsPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  return (
    <div>
      <PageHeading
        eyebrow="Payments"
        title="Payment reference tracking"
        description="Parked for now — AfrikaBurn never charges theme camps to register."
      />

      <EmptyState
        icon={<Wallet className="h-8 w-8" />}
        title="Payment reference tracking arrives with the logistics apps"
        description="Camps never pay for registration — it's free. When the logistics apps (containers, water, ice, gas) land, their fees will surface here as references to reconcile off-platform. The platform never processes money."
      />
    </div>
  );
}

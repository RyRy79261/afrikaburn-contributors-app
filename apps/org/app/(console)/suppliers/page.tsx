import Link from "next/link";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getSuppliersOverview } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { SuppliersTable } from "@/components/suppliers-table";
import { AddSupplierForm } from "@/components/add-supplier-form";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();
  const suppliers = await getSuppliersOverview(edition?.id ?? null);

  return (
    <div>
      <PageHeading
        eyebrow="Suppliers"
        title="Supplier repository"
        description="The repository camps pick from in Section 6. For each supplier the console shows three things: whether they onboarded properly, their standing, and the internal notes trail. Expand a row to confirm onboarding steps."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/suppliers/signup-management"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Sign-up management
            </Link>
            <AddSupplierForm />
          </div>
        }
      />

      {suppliers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No suppliers yet. Import the public list via the seed, or add one
            manually.
          </CardContent>
        </Card>
      ) : (
        /* Card chrome only at md+: below md the responsive table renders its own
           stacked cards (frame hSNjO), so an outer bordered box would
           double-nest. */
        <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow-sm">
          <SuppliersTable
            suppliers={suppliers}
            editionId={edition?.id ?? null}
          />
        </div>
      )}
    </div>
  );
}

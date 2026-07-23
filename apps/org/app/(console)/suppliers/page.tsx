import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { guardConsole } from "@/lib/gate";
import { getSuppliers } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { SupplierVettingSelect } from "@/components/supplier-vetting-select";
import { AddSupplierForm } from "@/components/add-supplier-form";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const suppliers = await getSuppliers();

  return (
    <div>
      <PageHeading
        eyebrow="Suppliers"
        title="Supplier repository"
        description="The vetting repository camps pick from in Section 6. Imported entries come from AfrikaBurn's public suppliers list; you can hand-add and vet others."
        actions={<AddSupplierForm />}
      />

      {suppliers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No suppliers yet. Import the public list via the seed, or add one
            manually.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Services</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Vetting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{s.name}</span>
                        {s.website && (
                          <a
                            href={s.website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1 text-xs text-accent hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            Website
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-muted-foreground">
                      {s.services ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.contact ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {s.source === "ab_sheet" ? "AB list" : "Manual"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <SupplierVettingSelect
                          supplierId={s.id}
                          value={s.vettingStatus}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

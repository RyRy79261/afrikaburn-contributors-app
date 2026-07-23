import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { getPayments } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { PaymentStatusBadge } from "@/components/status-badges";
import { PaymentActions } from "@/components/payment-actions";
import { formatMoney, formatDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const payments = await getPayments();

  return (
    <div>
      <PageHeading
        eyebrow="Payments"
        title="Payment references"
        description="The platform never processes money — it tracks references so AfrikaBurn can reconcile off-platform. Mark each reference reconciled or waived."
      />

      {payments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No payment references yet. They appear here as fees are recorded
            against camps and registrations.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {p.reference}
                    </TableCell>
                    <TableCell>
                      <span className="text-foreground">{p.subjectLabel}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({p.subjectType})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.amountCents, p.currency)}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PaymentActions paymentId={p.id} status={p.status} />
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

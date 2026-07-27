import { CalendarRange, FilePlus2, FileText, Info } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";

import { guardConsole } from "@/lib/gate";
import { getActiveEdition } from "@/lib/queries";
import { listSupplierDocuments } from "@/lib/actions/supplier-documents";
import { PageHeading } from "@/components/page-heading";
import { DocumentForm } from "@/components/supplier-documents/document-form";
import { DocumentsTable } from "@/components/supplier-documents/documents-table";

// /suppliers/signup-management — the org's per-edition supplier document list
// (canvas `U7929T` desktop / `D6IGel` mobile), apricot console accent.
//
// docs/accounts-security-spec.md §"Supplier documents — org-controlled": the
// org CRUDs the documents and links suppliers must read or download before
// onboarding — title, source, `required_ack`, sort order, and an optional
// binding to the onboarding step the acknowledgement completes.
//
// Authz is entirely server-side: `guardConsole` gates the page, and every
// action re-checks with `requireOrgSession` and audits. Hiding a button here is
// never the boundary.

export const dynamic = "force-dynamic";

export default async function SupplierSignupManagementPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();
  const documents = edition ? await listSupplierDocuments(edition.id) : [];
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  return (
    <div>
      <PageHeading
        eyebrow="Suppliers / Sign-up management"
        title="Supplier sign-up documents"
        description="Curate the per-edition list of documents and links suppliers must read or download before onboarding. Reorder them, mark which need acknowledgement, and bind a document to the onboarding step it unlocks."
        actions={
          edition ? (
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Edition
              </span>
              <Badge
                variant="outline"
                className="gap-1.5 py-1 text-sm normal-case"
              >
                <CalendarRange className="h-3.5 w-3.5" aria-hidden />
                {edition.name}
              </Badge>
            </div>
          ) : null
        }
      />

      {/* The apricot callout: what publishing here actually does. */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="text-muted-foreground">
          Suppliers see these on the Documents panel of their onboarding page in
          the Supplier Portal; required documents must be acknowledged before
          the bound step completes. Binding is limited to steps a supplier
          completes themselves — deposit, briefing and registration fee stay
          confirmations AfrikaBurn makes.
        </p>
      </div>

      {!edition ? (
        <EmptyState
          icon={<CalendarRange className="h-8 w-8" aria-hidden />}
          title="No active edition"
          description="Supplier documents are scoped to an edition. Set one active before curating the list."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {documents.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  className="border-0 bg-transparent"
                  icon={<FileText className="h-8 w-8" aria-hidden />}
                  title="No documents published yet"
                  description="Add the supplier agreement, the depot basics, and anything else a supplier must read for this edition."
                />
              </CardContent>
            </Card>
          ) : (
            /* Card chrome only at md+: below md the responsive table renders its
               own stacked cards (frame D6IGel), so an outer bordered box would
               double-nest. */
            <div className="md:rounded-xl md:border md:bg-card md:text-card-foreground md:shadow-sm">
              <DocumentsTable
                documents={documents}
                blobConfigured={blobConfigured}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
                  <FilePlus2 className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <CardTitle className="text-base">
                    Add a document or link
                  </CardTitle>
                  <CardDescription>
                    Point to a hosted file or an external URL — either can be
                    marked required.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DocumentForm
                mode="create"
                editionId={edition.id}
                blobConfigured={blobConfigured}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

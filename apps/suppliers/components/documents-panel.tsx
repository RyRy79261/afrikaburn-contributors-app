"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { setDocumentAcknowledgement } from "@/lib/actions/documents";

// The Documents & links panel on the supplier onboarding page (canvas Q4fye
// "Documents Panel"). Renders the org-published, per-edition document list;
// `requiredAck` documents carry a checkbox whose state feeds the bound
// onboarding step.
//
// The checkbox is NOT the security boundary — `setDocumentAcknowledgement`
// re-resolves the session, re-checks the document's edition, and reconciles the
// step map from committed state. This component only has to be honest about what
// it is showing.

export interface DocumentRow {
  id: string;
  title: string;
  sourceType: "file" | "link";
  url: string;
  requiredAck: boolean;
  acked: boolean;
  outstanding: boolean;
  /** Title of the onboarding step this document completes, when bound. */
  stepTitle: string | null;
}

export interface DocumentsPanelProps {
  documents: DocumentRow[];
  /** Required documents acknowledged / total required. */
  acked: number;
  required: number;
}

// A Vercel Blob URL serves inline by default; `?download=1` makes it a real
// attachment download. Only applied to blob-hosted files — an external "file"
// URL is opened as-is (we can't assume it honours the param).
function downloadHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return url;
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function DocumentsPanel({
  documents,
  acked,
  required,
}: DocumentsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(doc: DocumentRow, next: boolean) {
    startTransition(async () => {
      const result = await setDocumentAcknowledgement({
        documentId: doc.id,
        acknowledged: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? doc.stepTitle
            ? `Acknowledged — "${doc.stepTitle}" updated.`
            : "Acknowledged."
          : "Acknowledgement withdrawn.",
      );
      router.refresh();
    });
  }

  const allDone = required > 0 && acked === required;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Documents &amp; links</CardTitle>
            <CardDescription>
              {required > 0
                ? "Read each one. The ticked boxes are your acknowledgement — some of them complete a step above."
                : "Reference material from AfrikaBurn for this edition."}
            </CardDescription>
          </div>
          {required > 0 && (
            <Badge variant={allDone ? "success" : "secondary"}>
              {acked}/{required} acknowledged
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3",
              doc.outstanding ? "border-warning/40 bg-warning/5" : "border-border",
            )}
          >
            {doc.requiredAck ? (
              <Checkbox
                id={`doc-${doc.id}`}
                checked={doc.acked}
                disabled={pending}
                onChange={(e) => toggle(doc, e.currentTarget.checked)}
                className="mt-0.5"
                aria-describedby={`doc-${doc.id}-meta`}
              />
            ) : (
              <span className="mt-0.5 h-4 w-4" aria-hidden />
            )}

            <div className="min-w-0 flex-1">
              <label
                htmlFor={doc.requiredAck ? `doc-${doc.id}` : undefined}
                className="block text-sm font-medium"
              >
                {doc.requiredAck ? (
                  <>I&apos;ve read {doc.title}</>
                ) : (
                  doc.title
                )}
              </label>
              <p
                id={`doc-${doc.id}-meta`}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                {doc.stepTitle
                  ? `Acknowledging this completes "${doc.stepTitle}".`
                  : doc.requiredAck
                    ? "Acknowledgement required."
                    : "Optional reading."}
              </p>
            </div>

            <a
              href={
                doc.sourceType === "file" ? downloadHref(doc.url) : doc.url
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
            >
              {doc.sourceType === "file" ? (
                <>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download
                </>
              ) : (
                <>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Open
                </>
              )}
              <span className="sr-only"> {doc.title}</span>
            </a>
          </div>
        ))}
        {pending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Saving…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

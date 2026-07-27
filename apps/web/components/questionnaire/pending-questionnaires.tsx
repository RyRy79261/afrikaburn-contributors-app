import Link from "next/link";
import { ClipboardList } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Button } from "@quagga/ui/components/button";
import type { PendingQuestionnaire } from "@/lib/questionnaire-store";
import { BlockingBadge } from "./blocking-badge";

function formatDue(due: Date | null): string | null {
  if (!due) return null;
  try {
    return due.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * "Pending questionnaires" card — the non-blocking surface (questionnaire-spec
 * §Surfaces). Blocking ones normally gate the app before this renders, but any
 * that reach here still carry the explicit Required badge. Covers both
 * project- and org-authored sends.
 */
export function PendingQuestionnaires({
  items,
}: {
  items: readonly PendingQuestionnaire[];
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-accent" aria-hidden />
          Pending questionnaires ({items.length})
        </CardTitle>
        <CardDescription>
          Questions waiting for your answer, from your camps and AfrikaBurn.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {items.map((q) => {
            const due = formatDue(q.dueAt);
            return (
              <li
                key={q.activationId}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {q.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <BlockingBadge blocking={q.blocking} />
                    {due && (
                      <span className="text-xs text-muted-foreground">
                        Due {due}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={q.blocking ? "default" : "secondary"}
                >
                  <Link href={`/questionnaires/${q.activationId}`}>
                    {q.blocking ? "Complete now" : "Answer"}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

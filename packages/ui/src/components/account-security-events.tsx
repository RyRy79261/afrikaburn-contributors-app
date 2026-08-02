import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";

// "Recent security events" (canvas G35eq), shared by all three apps.
//
// This renders the real `security_events` LOG — an append-only record written at
// the moment each account action succeeds (password change/reset, session
// revocation, the email-change steps, deletion request/cancel), recorded thinly
// and best-effort by `recordSecurityEvent` in @quagga/auth/account.
//
// TITLES ARE RESOLVED BEFORE THEY GET HERE, by @quagga/core's
// `describeSecurityEvent`: no wording is stored in the database, and none is
// invented in this package.
//
// The closing note names what the feed does NOT contain, because a security log
// that quietly omits a category trains the reader to trust a completeness it
// does not have. Passed in rather than hardcoded — the participant app has a
// paragraph the other two do not need.

export interface SecurityEventRow {
  id: string;
  title: string;
  body: string | null;
  createdAt: Date;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AccountSecurityEvents({
  events,
  note,
  emptyDescription = "Password changes, password resets and sign-outs all land here the moment they happen.",
}: {
  events: readonly SecurityEventRow[];
  note?: React.ReactNode;
  emptyDescription?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security events</CardTitle>
        <CardDescription>
          What&rsquo;s happened to your account. We email you when these occur.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {events.length === 0 ? (
          <EmptyState
            title="Nothing to report"
            description={emptyDescription}
          />
        ) : (
          <ul className="flex flex-col">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.body ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {event.body}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(event.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {note ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {note}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

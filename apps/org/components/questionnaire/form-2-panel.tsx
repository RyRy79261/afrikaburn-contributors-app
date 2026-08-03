"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleAlert, Send } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { toast } from "@quagga/ui/components/toast";

import { sendForm2, type Form2CampStatus } from "@/lib/actions/form-2";

// FORM 2, on the questionnaires page (roadmap M4-20).
//
// AfrikaBurn's January form: size, placement, sound and the mandatory layout
// diagram, asked of camps whose Form 1 was approved in September.
//
// It gets its own panel rather than being one row in the questionnaire list,
// because it is not sent like the others. Every other questionnaire goes to an
// audience; this one fans out to ONE ACTIVATION PER CAMP so that a lead of two
// camps is asked twice — and the thing an organiser actually needs afterwards is
// not "was it sent" but "who hasn't come back yet".

function Row({ camp }: { camp: Form2CampStatus }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 last:pb-0">
      <span className="min-w-0 truncate text-sm">{camp.name}</span>
      <div className="flex shrink-0 items-center gap-2">
        {camp.unfilled.length > 0 ? (
          // The case worth surfacing: they answered and something did not land.
          // Almost always a question id renamed in the builder, which breaks the
          // mirror silently everywhere else.
          <Badge
            variant="warning"
            title={`Answered, but these did not map: ${camp.unfilled.join(", ")}`}
          >
            <CircleAlert className="mr-1 h-3 w-3" aria-hidden />
            {camp.unfilled.length} unfilled
          </Badge>
        ) : null}
        {camp.answered ? (
          <Badge variant="success">Answered</Badge>
        ) : camp.asked ? (
          <Badge variant="secondary">Waiting</Badge>
        ) : (
          <Badge variant="outline">Not sent</Badge>
        )}
      </div>
    </li>
  );
}

export function Form2Panel({
  editionId,
  editionName,
  camps,
  canSend,
}: {
  editionId: string;
  editionName: string;
  camps: Form2CampStatus[];
  /** `create` on questionnaires. The server re-checks; this only hides. */
  canSend: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const outstanding = camps.filter((c) => !c.answered);
  const unsent = camps.filter((c) => !c.asked);
  const misfilled = camps.filter((c) => c.unfilled.length > 0);

  function send() {
    startTransition(async () => {
      const result = await sendForm2({ editionId });
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-accent" aria-hidden />
          Form 2 — {editionName}
        </CardTitle>
        <CardDescription>
          Size, placement, sound and the layout diagram. Sent to camps whose
          registration you approved — one form per camp, so a lead of two camps
          is asked for each of them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {camps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            No approved theme camps yet. Form 2 goes out once Form 1
            registrations start being approved.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {camps.length - outstanding.length} of {camps.length} answered
              </span>
              {canSend ? (
                <Button size="sm" onClick={send} disabled={pending || unsent.length === 0}>
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                  {pending
                    ? "Sending…"
                    : unsent.length === 0
                      ? "All camps have it"
                      : `Send to ${unsent.length} camp${unsent.length === 1 ? "" : "s"}`}
                </Button>
              ) : null}
            </div>

            {misfilled.length > 0 ? (
              // Loud on purpose. A camp that answered while its columns stayed
              // empty means the questionnaire and the mirror have drifted apart,
              // and every downstream reader — officer requirements, placement —
              // is working from a blank.
              <div
                role="alert"
                className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p className="font-medium text-foreground">
                  {misfilled.length} camp{misfilled.length === 1 ? " has" : "s have"}{" "}
                  answered without every answer landing.
                </p>
                <p className="mt-1 text-muted-foreground">
                  That usually means a question was renamed in the builder, which
                  breaks the link to the registration record. The camp did
                  nothing wrong and does not need to re-answer — the form needs
                  its original question ids back.
                </p>
              </div>
            ) : null}

            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {camps.map((camp) => (
                <Row key={camp.groupId} camp={camp} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

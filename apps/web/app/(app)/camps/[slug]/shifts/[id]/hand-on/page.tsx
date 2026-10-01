import { notFound } from "next/navigation";
import { formatShiftTime } from "@quagga/core";
import { Card, CardContent } from "@quagga/ui/components/card";
import { PreviewNotice } from "@/components/preview-notice";
import { DateBlock } from "@/components/shifts/date-block";
import { HandOnForm } from "@/components/shifts/hand-on-form";
import { ShiftActionButton } from "@/components/shifts/shift-action-button";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { candidatesFor } from "@/components/shifts/view-model";
import { leaveShiftAction, withdrawHandOnAction } from "../../actions";
import { loadShiftsContext } from "../../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/shifts/[id]/hand-on (canvas S4). Only the person on the shift
// reaches it; anyone else gets the 404 a missing shift gets.
export default async function HandOnPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await loadShiftsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp shifts" />;
  const { camp, board, me } = ctx;
  const shift = board.shifts.find((s) => s.id === id);
  const mine = shift?.assignments.find(
    (a) => a.membershipId === me.membershipId,
  );
  if (!shift || !mine) notFound();

  const others = shift.assignments
    .filter((a) => a.id !== mine.id)
    .map((a) => a.displayName);
  const { candidates } = candidatesFor(
    shift,
    board.members,
    board.shifts,
    me.membershipId,
  );
  const back = `/camps/${camp.slug}/shifts/mine`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={back}
        backLabel="My shifts"
        title="Hand on a shift"
        description="Can't make it? Hand it to a campmate who has agreed, or put it up for anyone to take. No approval needed."
      />
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <DateBlock date={shift.date} />
            <div>
              <p className="font-medium">{shift.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatShiftTime(shift.startMinute, shift.durationMinutes)}
                {others.length ? ` · with ${others.join(", ")}` : ""}
              </p>
            </div>
          </div>
          {mine.handoverTo || mine.offered ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                {mine.handoverTo
                  ? `Sent to ${mine.handoverTo.displayName} · waiting for them to accept. You're still on it until they do.`
                  : "Posted to Open shifts · the first person to take it gets it. You're still on it until someone does."}
              </p>
              <ShiftActionButton
                action={withdrawHandOnAction}
                payload={{ slug: camp.slug, shiftId: shift.id }}
                variant="outline"
                successMessage="It's back with you."
                redirectTo={back}
              >
                {mine.offered ? "Take it back" : "Withdraw"}
              </ShiftActionButton>
            </div>
          ) : (
            <HandOnForm
              slug={camp.slug}
              shiftId={shift.id}
              shiftName={shift.name}
              candidates={candidates}
            />
          )}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Signed up by mistake? You can take yourself off — the spot goes back
          to the camp.
        </p>
        <ShiftActionButton
          action={leaveShiftAction}
          payload={{ slug: camp.slug, shiftId: shift.id }}
          variant="ghost"
          confirm="Take me off"
          successMessage="You're off the shift."
          redirectTo={back}
          className="-ml-3 w-fit"
        >
          Take me off this shift
        </ShiftActionButton>
      </div>
    </div>
  );
}

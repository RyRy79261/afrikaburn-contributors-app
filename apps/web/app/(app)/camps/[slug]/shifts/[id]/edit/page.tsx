import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { PreviewNotice } from "@/components/preview-notice";
import { AssignDialog } from "@/components/shifts/assign-dialog";
import { ShiftActionButton } from "@/components/shifts/shift-action-button";
import { ShiftForm } from "@/components/shifts/shift-form";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { candidatesFor, shiftLabel } from "@/components/shifts/view-model";
import {
  deleteShiftAction,
  unassignFromShiftAction,
} from "../../actions";
import { loadManagerContext } from "../../context";
import { shiftFormRoles } from "../../roles";

export const dynamic = "force-dynamic";

// /camps/[slug]/shifts/[id]/edit — change a shift, see who is on it, take
// someone off, assign, or cancel the shift. Leads and co-leads only.
export default async function EditShiftPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await loadManagerContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp shifts" />;
  const { camp, board, days } = ctx;
  const shift = board.shifts.find((s) => s.id === id);
  if (!shift) notFound();
  const roles = await shiftFormRoles(camp.id, board);
  const gaps = shift.capacity - shift.assignments.length;
  const { candidates, excludedNote } = candidatesFor(
    shift,
    board.members,
    board.shifts,
  );
  const base = `/camps/${camp.slug}/shifts`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={`${base}?day=${shift.date}`}
        backLabel="Shifts"
        title="Edit shift"
        description="People on it get an in-app notice if you change its day or time."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            On this shift ({shift.assignments.length} of {shift.capacity})
          </CardTitle>
          <CardDescription>
            Taking someone off tells them in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {shift.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {shift.assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="text-sm">
                    {a.displayName}
                    {a.offered && (
                      <span className="text-muted-foreground">
                        {" "}
                        · needs a replacement
                      </span>
                    )}
                    {a.handoverTo && (
                      <span className="text-muted-foreground">
                        {" "}
                        · handing on to {a.handoverTo.displayName}
                      </span>
                    )}
                  </span>
                  <ShiftActionButton
                    action={unassignFromShiftAction}
                    payload={{
                      slug: camp.slug,
                      shiftId: shift.id,
                      assignmentId: a.id,
                    }}
                    variant="ghost"
                    confirm="Take off"
                    successMessage={`${a.displayName} is off the shift.`}
                  >
                    Take off
                  </ShiftActionButton>
                </li>
              ))}
            </ul>
          )}
          {gaps > 0 && (
            <AssignDialog
              slug={camp.slug}
              shiftId={shift.id}
              shiftLabel={shiftLabel(shift)}
              candidates={candidates}
              excludedNote={excludedNote}
              className="w-fit"
            />
          )}
        </CardContent>
      </Card>

      <ShiftForm
        slug={camp.slug}
        days={days}
        teams={board.teams}
        roles={roles}
        initial={{
          id: shift.id,
          name: shift.name,
          teamId: shift.teamId,
          date: shift.date,
          startMinute: shift.startMinute,
          durationMinutes: shift.durationMinutes,
          capacity: shift.capacity,
          requiredRoleId: shift.requiredRoleId,
          signupMode: shift.signupMode,
        }}
      />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Cancel this shift</CardTitle>
          <CardDescription>
            It&apos;s removed for everyone, and the people on it get an in-app
            notice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShiftActionButton
            action={deleteShiftAction}
            payload={{ slug: camp.slug, shiftId: shift.id }}
            variant="outline"
            confirm="Cancel shift"
            successMessage="Shift cancelled."
            redirectTo={`${base}?day=${shift.date}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Cancel shift
          </ShiftActionButton>
        </CardContent>
      </Card>
    </div>
  );
}

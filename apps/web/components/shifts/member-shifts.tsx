import Link from "next/link";
import {
  ArrowLeftRight,
  Hourglass,
  Lock,
  Megaphone,
  Plus,
  Undo2,
} from "lucide-react";
import {
  clashesWith,
  formatShiftTime,
  holdsShiftSkill,
  openSpots,
  shiftDateLabel,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { cn } from "@quagga/ui/lib/utils";
import {
  respondToHandOnAction,
  signUpForShiftAction,
  takeOfferedShiftAction,
  withdrawHandOnAction,
} from "@/app/(app)/camps/[slug]/shifts/actions";
import type {
  ShiftBoard,
  ShiftMemberView,
  ShiftView,
} from "@/lib/shifts-store";
import { DateBlock } from "./date-block";
import { ShiftActionButton } from "./shift-action-button";
import { TeamFilter } from "./team-filter";
import { scheduleSummary, todayIso } from "./view-model";

// The member's Shifts view (canvas S3 `M3rNVI` / `pf8nm`): requests handed to
// them, their own schedule, and the open shifts they could pick up — every
// day of the burn, build and strike included, never filtered by travel plans
// (Ryan, 28 Sep 2026). Signing up is optional; nothing here is required.

interface OpenItem {
  shift: ShiftView;
  /** Set when this is an offered spot rather than an empty one. */
  offeredAssignmentId: string | null;
  offeredBy: string | null;
  spotsLeft: number;
}

function withOthers(shift: ShiftView, me: ShiftMemberView): string {
  const others = shift.assignments
    .filter((a) => a.membershipId !== me.membershipId)
    .map((a) => a.displayName);
  return others.length ? ` · with ${others.join(", ")}` : "";
}

export function MemberShifts({
  slug,
  board,
  me,
  teamFilter,
  basePath,
}: {
  slug: string;
  board: ShiftBoard;
  me: ShiftMemberView;
  teamFilter: string | null;
  /** Where the team filter links point (this page). */
  basePath: string;
}) {
  const mine = board.shifts.filter((s) =>
    s.assignments.some((a) => a.membershipId === me.membershipId),
  );
  const requests = board.shifts.filter((s) =>
    s.assignments.some((a) => a.handoverTo?.membershipId === me.membershipId),
  );
  const today = todayIso();
  const nextId = mine.find((s) => s.date >= today)?.id ?? null;

  const open: OpenItem[] = [];
  for (const s of board.shifts) {
    if (s.assignments.some((a) => a.membershipId === me.membershipId)) continue;
    const spots = openSpots(s);
    if (s.signupMode === "open" && spots > 0) {
      open.push({
        shift: s,
        offeredAssignmentId: null,
        offeredBy: null,
        spotsLeft: spots,
      });
    }
    for (const a of s.assignments.filter((x) => x.offered)) {
      open.push({
        shift: s,
        offeredAssignmentId: a.id,
        offeredBy: a.displayName,
        spotsLeft: 1,
      });
    }
  }
  const openTeams = [
    ...new Map(
      open
        .filter((o) => o.shift.teamId && o.shift.teamName)
        .map((o) => [o.shift.teamId!, o.shift.teamName!]),
    ),
  ];
  const shownOpen = teamFilter
    ? open.filter((o) => o.shift.teamId === teamFilter)
    : open;
  const held = new Set(me.heldRoleIds);

  return (
    <div className="flex flex-col gap-6">
      {requests.map((s) => {
        const from = s.assignments.find(
          (a) => a.handoverTo?.membershipId === me.membershipId,
        )!;
        return (
          <Card key={s.id} className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowLeftRight className="h-4 w-4 text-primary" aria-hidden />
                {from.displayName} wants to hand you {s.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
                <p className="font-medium">
                  {s.name} — {shiftDateLabel(s.date).medium},{" "}
                  {formatShiftTime(s.startMinute, s.durationMinutes)}
                </p>
                <p className="text-muted-foreground">
                  {s.assignments.length > 1
                    ? `With ${s.assignments
                        .filter((a) => a.id !== from.id)
                        .map((a) => a.displayName)
                        .join(", ")}`
                    : "Nobody else on it yet"}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Accept and it&apos;s yours. Nobody else needs to approve it.
                Decline and nothing changes.
              </p>
              <div className="flex flex-wrap gap-2">
                <ShiftActionButton
                  action={respondToHandOnAction}
                  payload={{ slug, shiftId: s.id, accept: true }}
                  variant="default"
                  successMessage={`${s.name} is yours now.`}
                  pendingLabel="Accepting…"
                >
                  Accept
                </ShiftActionButton>
                <ShiftActionButton
                  action={respondToHandOnAction}
                  payload={{ slug, shiftId: s.id, accept: false }}
                  variant="outline"
                  successMessage="Declined — it stays with them."
                  pendingLabel="Declining…"
                >
                  Decline
                </ShiftActionButton>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">My shifts</CardTitle>
          {mine.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {scheduleSummary(mine)}
            </span>
          )}
        </CardHeader>
        <CardContent>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re not on any shifts yet.
              {open.length > 0 ? " Pick one up below if you can." : ""}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {mine.map((s) => {
                const a = s.assignments.find(
                  (x) => x.membershipId === me.membershipId,
                )!;
                return (
                  <li
                    key={s.id}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                    data-testid="my-shift"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <DateBlock date={s.date} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {s.name}
                          {s.id === nextId && (
                            <Badge className="bg-primary text-primary-foreground">
                              Next
                            </Badge>
                          )}
                          {a.handoverTo && (
                            <Badge variant="secondary">Handing on</Badge>
                          )}
                          {a.offered && (
                            <Badge variant="secondary">In open shifts</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatShiftTime(s.startMinute, s.durationMinutes)}
                          {withOthers(s, me)}
                        </p>
                        {a.handoverTo && (
                          <p className="mt-1 flex items-center gap-1.5 text-sm">
                            <Hourglass
                              className="h-4 w-4 text-warning"
                              aria-hidden
                            />
                            Sent to {a.handoverTo.displayName} · waiting for
                            them to accept
                          </p>
                        )}
                        {a.offered && (
                          <p className="mt-1 flex items-center gap-1.5 text-sm">
                            <Megaphone
                              className="h-4 w-4 text-primary"
                              aria-hidden
                            />
                            Posted to Open shifts · the first person to take it
                            gets it
                          </p>
                        )}
                      </div>
                    </div>
                    {a.handoverTo || a.offered ? (
                      <ShiftActionButton
                        action={withdrawHandOnAction}
                        payload={{ slug, shiftId: s.id }}
                        variant="outline"
                        successMessage="It's back with you."
                      >
                        <Undo2 className="h-4 w-4" aria-hidden />
                        {a.offered ? "Take it back" : "Withdraw"}
                      </ShiftActionButton>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/camps/${slug}/shifts/${s.id}/hand-on`}>
                          <ArrowLeftRight className="h-4 w-4" aria-hidden />
                          Offer or swap
                        </Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open shifts</CardTitle>
          <CardDescription>
            Spots nobody has taken yet, and shifts campmates need a replacement
            for. Sign up and it lands in My shifts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {openTeams.length > 0 && (
            <TeamFilter
              teams={openTeams.map(([id, name]) => ({
                id,
                name,
                href: `${basePath}?team=${id}`,
              }))}
              allHref={basePath}
              active={teamFilter}
            />
          )}
          {shownOpen.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {board.shifts.length === 0
                ? "Your camp hasn't set up any shifts yet."
                : "No open spots right now."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {shownOpen.map((o) => {
                const s = o.shift;
                const needsRole = !holdsShiftSkill(s.requiredRoleId, held);
                const clash = clashesWith(s, {
                  otherShifts: mine.filter((m) => m.id !== s.id),
                });
                return (
                  <li
                    key={`${s.id}:${o.offeredAssignmentId ?? "open"}`}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                    data-testid="open-shift"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <DateBlock date={s.date} />
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "font-medium",
                            needsRole && "text-muted-foreground",
                          )}
                        >
                          {s.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatShiftTime(s.startMinute, s.durationMinutes)}
                          {o.offeredBy
                            ? ` · ${o.offeredBy} needs a replacement`
                            : ` · ${o.spotsLeft} spot${o.spotsLeft === 1 ? "" : "s"} left`}
                          {clash && !needsRole
                            ? " · clashes with one of your shifts"
                            : ""}
                        </p>
                      </div>
                    </div>
                    {needsRole ? (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Lock className="h-4 w-4" aria-hidden />
                        Needs {s.requiredRoleName ?? "a camp role"}
                      </span>
                    ) : clash ? (
                      <span className="text-sm text-muted-foreground">
                        You&apos;re busy then
                      </span>
                    ) : o.offeredAssignmentId ? (
                      <ShiftActionButton
                        action={takeOfferedShiftAction}
                        payload={{
                          slug,
                          shiftId: s.id,
                          assignmentId: o.offeredAssignmentId,
                        }}
                        successMessage={`${s.name} is yours now.`}
                        pendingLabel="Taking…"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Take it
                      </ShiftActionButton>
                    ) : (
                      <ShiftActionButton
                        action={signUpForShiftAction}
                        payload={{ slug, shiftId: s.id }}
                        successMessage={`You're on ${s.name}.`}
                        pendingLabel="Signing up…"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Sign up
                      </ShiftActionButton>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

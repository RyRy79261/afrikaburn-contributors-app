"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Pencil, Plus, UserPlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import {
  addTeamMembersAction,
  joinTeamAction,
  leaveTeamAction,
  removeTeamMemberAction,
} from "@/app/(app)/camps/[slug]/teams/actions";
import { PeoplePicker, type PickablePerson } from "./people-picker";
import { TeamForm, type EditableTeam } from "./team-form";

// The team pages' client controls (frames T1, T2). Each one calls a server
// action that re-parses with Zod and re-decides with @quagga/core under the
// store's locks; showing a control here grants nothing.

/** "New team" (camp leads): the create form in a dialog. */
export function NewTeamButton({
  slug,
  leadCandidates,
  className,
  label = "New team",
  icon = true,
}: {
  slug: string;
  leadCandidates: readonly PickablePerson[];
  className?: string;
  label?: string;
  icon?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={className}>
          {icon && <Plus className="h-4 w-4" aria-hidden />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription className="sr-only">
            Name the team, say what it does and who can join.
          </DialogDescription>
        </DialogHeader>
        <TeamForm
          slug={slug}
          leadCandidates={leadCandidates}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** "Edit team" (team leads and camp leads). */
export function EditTeamButton({
  slug,
  team,
  canArchive,
  className,
}: {
  slug: string;
  team: EditableTeam;
  canArchive: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Pencil className="h-4 w-4" aria-hidden />
          Edit team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit team</DialogTitle>
          <DialogDescription className="sr-only">
            Change the team&apos;s name, description, who can join and its
            leads.
          </DialogDescription>
        </DialogHeader>
        <TeamForm
          slug={slug}
          team={team}
          canArchive={canArchive}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** "+ Join" on a team row or page — into the team and its chat, from now. */
export function JoinTeamButton({
  slug,
  teamId,
  teamName,
  variant = "secondary",
  size = "sm",
  className,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  variant?: "default" | "secondary";
  size?: "sm" | "default";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      aria-label={`Join ${teamName}`}
      onClick={() =>
        startTransition(async () => {
          const result = await joinTeamAction({ slug, teamId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`You joined ${teamName}. Its chat is in Messages.`);
          router.refresh();
        })
      }
    >
      <Plus className="h-4 w-4" aria-hidden />
      Join
    </Button>
  );
}

/** "Leave" — confirm first (frame T2 state 6). */
export function LeaveTeamButton({
  slug,
  teamId,
  teamName,
  className,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <LogOut className="h-4 w-4" aria-hidden />
          Leave
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {teamName}?</DialogTitle>
          <DialogDescription>
            You leave the team chat and keep nothing of it. You can join again —
            you&apos;d see messages from then on.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Stay
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await leaveTeamAction({ slug, teamId });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setOpen(false);
                toast.success(`You left ${teamName}.`);
                router.refresh();
              })
            }
          >
            Leave team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Add people" (frame T2 state 4): only current camp members not on the
 * team are listed; each person added is told. */
export function AddPeopleButton({
  slug,
  teamId,
  teamName,
  candidates,
  className,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  candidates: readonly PickablePerson[];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const n = selected.size;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelected(new Set());
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Add people
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people to {teamName}</DialogTitle>
          <DialogDescription className="sr-only">
            Choose camp members to add to the team.
          </DialogDescription>
        </DialogHeader>
        <PeoplePicker
          people={candidates}
          selected={selected}
          onChange={setSelected}
        />
        <p className="text-sm text-muted-foreground">
          They get a notice: &ldquo;You were added to {teamName}&rdquo;. They
          see the chat from now on.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || n === 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await addTeamMembersAction({
                  slug,
                  teamId,
                  userIds: [...selected],
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                setSelected(new Set());
                toast.success(
                  `Added ${result.added} ${result.added === 1 ? "person" : "people"} to ${teamName}.`,
                );
                router.refresh();
              })
            }
          >
            {n === 0
              ? "Add people"
              : `Add ${n} ${n === 1 ? "person" : "people"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Remove" one person — confirm first (frame T2 state 5). Their shifts
 * stay as they are. */
export function RemoveMemberButton({
  slug,
  teamId,
  teamName,
  person,
  className,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  person: PickablePerson;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 px-2 text-muted-foreground", className)}
          aria-label={`Remove ${person.displayName} from ${teamName}`}
        >
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Remove {person.displayName} from {teamName}?
          </DialogTitle>
          <DialogDescription>
            They leave the team chat and can&apos;t read it any more. Their
            shifts stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeTeamMemberAction({
                  slug,
                  teamId,
                  userId: person.userId,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setOpen(false);
                toast.success(`${person.displayName} is off ${teamName}.`);
                router.refresh();
              })
            }
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

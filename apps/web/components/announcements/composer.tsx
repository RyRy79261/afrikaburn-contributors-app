"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Send, Trash2 } from "lucide-react";
import type { AnnouncementPresentation } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { AckRow } from "@quagga/ui/components/checkbox";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { cn } from "@quagga/ui/lib/utils";
import {
  chosenTeamNames,
  teamLeadNotice,
  teamMemberCount,
  announcementTeamReach,
  type TeamOption,
} from "@/lib/team-audience-view";
import { offeredAudienceRoleIds } from "@/lib/meeting-view";
import type { AnnouncementActionResult } from "@/app/(app)/camps/[slug]/announcements/actions";

// The camp announcement composer (epic #56). NEEDS DESIGN REVIEW — built from
// existing components (the org bulletin composer's Field/MarkdownEditor, the
// questionnaire builder's audience toggle) with no canvas frame yet.
//
// UI only: every choice here is re-validated by the action (Zod) and
// re-authorised by the store inside the publish transaction. The scope props
// grey out what the server would refuse, so an author never writes a whole
// announcement to discover their permission doesn't cover the audience.

export interface ComposerRole {
  id: string;
  name: string;
}

export interface ComposerDraft {
  id: string;
  title: string;
  bodyMd: string;
  mode: "everyone" | "roles" | "teams";
  roleIds: string[];
  /** Chosen camp teams, when `mode` is `teams`. */
  teamIds?: string[];
  presentation: AnnouncementPresentation;
  pinOnPublish: boolean;
  meetingUrl: string | null;
  /** ISO instant, or null. */
  sendAt: string | null;
}

/** What this sender may address, from the server's own predicate. */
export interface ComposerScope {
  canTargetEveryone: boolean;
  targetableRoleIds: string[];
  /** Teams this sender may address (docs/team-audiences-spec.md). */
  targetableTeamIds: string[];
  /** A team lead without `post_announcements`: only "By team", only their
   * teams, with the one-line reason (frame knWLt, state 1). */
  teamsOnly: boolean;
  mayRequireAck: boolean;
}

type SaveAction = (
  raw: unknown,
) => Promise<AnnouncementActionResult<{ id: string }>>;
type IdAction = (raw: unknown) => Promise<AnnouncementActionResult>;
type PublishAction = (
  raw: unknown,
) => Promise<
  AnnouncementActionResult<{ recipients: number; scheduledFor: string | null }>
>;

/** An ISO instant → the value a `datetime-local` input shows (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value (browser-local) → an ISO instant, or "". */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** The camp announcement composer: title, message, audience, how it lands. */
export function AnnouncementComposer({
  slug,
  roles,
  teams,
  members,
  scope,
  draft,
  initialTeamIds,
  schedulingEnabled,
  saveAction,
  publishAction,
  deleteAction,
}: {
  slug: string;
  roles: ComposerRole[];
  /** The camp's live teams the picker lists (only the sender's own for a
   * team lead without the camp-wide permission). */
  teams: TeamOption[];
  /** Per member, the role ids they hold and the teams they are on (for the
   * live "resolves to" count). */
  members: { roleIds: string[]; teamIds?: string[] }[];
  scope: ComposerScope;
  draft?: ComposerDraft;
  /** A new announcement opened from a team page: start on "By team" with
   * this team chosen. Ignored when editing a draft. */
  initialTeamIds?: string[];
  /** Is a scheduler wired to the dispatch route? Off hides "Send later"
   * entirely (the server refuses a send time anyway). */
  schedulingEnabled: boolean;
  saveAction: SaveAction;
  publishAction: PublishAction;
  deleteAction: IdAction;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(draft?.title ?? "");
  const [bodyMd, setBodyMd] = React.useState(draft?.bodyMd ?? "");
  const startTeams = draft
    ? offeredAudienceRoleIds(draft.teamIds ?? [], teams)
    : (initialTeamIds ?? []);
  const [mode, setMode] = React.useState<"everyone" | "roles" | "teams">(
    scope.teamsOnly
      ? "teams"
      : (draft?.mode ??
          (startTeams.length > 0
            ? "teams"
            : scope.canTargetEveryone
              ? "everyone"
              : "roles")),
  );
  const [roleIds, setRoleIds] = React.useState<string[]>(draft?.roleIds ?? []);
  const [teamIds, setTeamIds] = React.useState<string[]>(startTeams);
  const [presentation, setPresentation] =
    React.useState<AnnouncementPresentation>(draft?.presentation ?? "feed");
  const [pinOnPublish, setPinOnPublish] = React.useState(
    draft?.pinOnPublish ?? false,
  );
  const [meetingUrl, setMeetingUrl] = React.useState(draft?.meetingUrl ?? "");
  const [sendAtLocal, setSendAtLocal] = React.useState(
    schedulingEnabled ? toLocalInput(draft?.sendAt ?? null) : "",
  );

  const targetable = new Set(scope.targetableRoleIds);
  const targetableTeams = new Set(scope.targetableTeamIds);
  const teamNames = chosenTeamNames(teams, teamIds);
  const base = `/camps/${slug}/announcements`;

  // The live count EXCLUDES nobody the server would include except the author
  // themselves (who never receives their own announcement) — so it may read
  // one high for an author inside their own audience. It is a guide; the
  // publish result states the real number.
  const resolvedCount = React.useMemo(() => {
    if (mode === "everyone") return members.length;
    if (mode === "teams") return teamMemberCount(members, teamIds);
    if (roleIds.length === 0) return 0;
    const wanted = new Set(roleIds);
    return members.filter((m) => m.roleIds.some((id) => wanted.has(id))).length;
  }, [mode, roleIds, teamIds, members]);

  function payload() {
    return {
      slug,
      id: draft?.id,
      title,
      bodyMd,
      mode,
      roleIds: mode === "roles" ? roleIds : [],
      teamIds: mode === "teams" ? teamIds : [],
      presentation,
      pinOnPublish,
      meetingUrl: meetingUrl.trim(),
      sendAt: fromLocalInput(sendAtLocal),
    };
  }

  function save(thenPublish: boolean) {
    startTransition(async () => {
      const saved = await saveAction(payload());
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      if (!thenPublish) {
        toast.success("Draft saved — only you can see it.");
        router.push(`${base}/${saved.id}`);
        router.refresh();
        return;
      }
      const published = await publishAction({ slug, id: saved.id });
      if (!published.ok) {
        toast.error(published.error);
        // The draft was saved; land on it so the author can fix and retry.
        router.push(`${base}/${saved.id}`);
        router.refresh();
        return;
      }
      toast.success(
        published.scheduledFor
          ? `Scheduled for ${new Date(published.scheduledFor).toLocaleString("en-GB")}.`
          : `Announcement published to ${published.recipients} ${
              published.recipients === 1 ? "member" : "members"
            }.`,
      );
      router.push(`${base}/${saved.id}`);
      router.refresh();
    });
  }

  function remove() {
    if (!draft) return;
    startTransition(async () => {
      const result = await deleteAction({ slug, id: draft.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft deleted.");
      router.push(base);
      router.refresh();
    });
  }

  const optionButton = (active: boolean) =>
    cn(
      "flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-input bg-background text-muted-foreground hover:bg-muted",
    );

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <Field
          label="Title"
          htmlFor="announcement-title"
          required
          help="This becomes the notification headline."
        >
          <Input
            id="announcement-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Build week starts Friday"
          />
        </Field>

        <Field
          label="Message"
          htmlFor="announcement-body"
          required
          help="Markdown supported. Don't include anyone's personal details."
        >
          <MarkdownEditor
            value={bodyMd}
            onChange={setBodyMd}
            ariaLabel="Announcement message"
          />
        </Field>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">Who it goes to</span>
          {scope.teamsOnly ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              {teamLeadNotice(
                teams.map((t) => t.name),
                "announcement",
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              {(teams.length > 0
                ? (["everyone", "roles", "teams"] as const)
                : (["everyone", "roles"] as const)
              ).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={
                    (m === "everyone" && !scope.canTargetEveryone) ||
                    (m === "teams" && targetableTeams.size === 0)
                  }
                  onClick={() => setMode(m)}
                  className={optionButton(mode === m)}
                >
                  {m === "everyone"
                    ? "Everyone in this camp"
                    : m === "roles"
                      ? "By role"
                      : "By team"}
                </button>
              ))}
            </div>
          )}
          {mode === "roles" &&
            (roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No roles yet — add some from the members card, or send to
                everyone.
              </p>
            ) : (
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={roleIds}
                onValueChange={setRoleIds}
                className="flex-wrap justify-start"
                aria-label="Roles"
              >
                {roles.map((r) => (
                  <ToggleGroupItem
                    key={r.id}
                    value={r.id}
                    disabled={!targetable.has(r.id)}
                    title={
                      targetable.has(r.id)
                        ? undefined
                        : "Outside your announcement permission"
                    }
                  >
                    {r.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ))}
          {mode === "teams" && (
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={teamIds}
              onValueChange={setTeamIds}
              className="flex-wrap justify-start"
              aria-label="Teams"
            >
              {teams.map((t) => (
                <ToggleGroupItem
                  key={t.id}
                  value={t.id}
                  disabled={!targetableTeams.has(t.id)}
                  title={
                    targetableTeams.has(t.id)
                      ? undefined
                      : "You can only send to the teams you lead"
                  }
                >
                  {t.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <p className="text-sm text-muted-foreground">
            Reaches about{" "}
            <span className="font-semibold text-foreground">
              {resolvedCount} {resolvedCount === 1 ? "member" : "members"}
            </span>{" "}
            {mode === "teams"
              ? announcementTeamReach(teamNames)
              : "right now — current members only, never pending invitees."}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">How it lands</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              aria-pressed={presentation === "feed"}
              onClick={() => setPresentation("feed")}
              className={optionButton(presentation === "feed")}
            >
              <span className="block font-medium text-foreground">
                In their inbox
              </span>
              <span className="block text-xs">An ordinary notification.</span>
            </button>
            <button
              type="button"
              aria-pressed={presentation === "acknowledge"}
              disabled={!scope.mayRequireAck}
              onClick={() => setPresentation("acknowledge")}
              className={optionButton(presentation === "acknowledge")}
            >
              <span className="block font-medium text-foreground">
                Must acknowledge
              </span>
              <span className="block text-xs">
                Full screen until they tick &ldquo;I&apos;ve read this&rdquo;.
                Also emailed.
              </span>
            </button>
          </div>
        </div>

        <AckRow
          checked={pinOnPublish}
          onChange={(e) => setPinOnPublish(e.currentTarget.checked)}
        >
          Pin to the camp dashboard when it goes out — it stays in a banner for
          the people who received it until you unpin it.
        </AckRow>

        <Field
          label="Meeting link"
          htmlFor="announcement-meeting"
          help="Optional. A full https:// link."
        >
          <Input
            id="announcement-meeting"
            type="url"
            inputMode="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://"
          />
        </Field>

        {schedulingEnabled && (
          <Field
            label="Send later"
            htmlFor="announcement-send-at"
            help="Optional. Leave empty to send when you publish. A scheduled send goes out on the next dispatch run after this time."
          >
            <Input
              id="announcement-send-at"
              type="datetime-local"
              value={sendAtLocal}
              onChange={(e) => setSendAtLocal(e.target.value)}
            />
          </Field>
        )}

        <div className="flex items-start gap-2.5 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-sm text-foreground">
            Once published, an announcement can&apos;t be edited or deleted. If
            you need answers from people, send a questionnaire instead.
          </p>
        </div>

        {/* Full-width and stacked on a phone, as the meeting form's actions
            are (frame y2O4gf). */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            onClick={() => save(true)}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            <Send className="h-4 w-4" aria-hidden />
            {sendAtLocal ? "Schedule announcement" : "Publish announcement"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => save(false)}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            Save draft
          </Button>
          {draft && (
            <Button
              variant="ghost"
              onClick={remove}
              disabled={pending}
              className="w-full sm:w-auto"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete draft
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

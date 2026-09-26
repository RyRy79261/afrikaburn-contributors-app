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
  mode: "everyone" | "roles";
  roleIds: string[];
  presentation: AnnouncementPresentation;
  pinOnPublish: boolean;
  meetingUrl: string | null;
  /** ISO instant, or null. */
  sendAt: string | null;
}

export interface ComposerScope {
  canTargetEveryone: boolean;
  targetableRoleIds: string[];
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

export function AnnouncementComposer({
  slug,
  roles,
  members,
  scope,
  draft,
  schedulingEnabled,
  saveAction,
  publishAction,
  deleteAction,
}: {
  slug: string;
  roles: ComposerRole[];
  /** Per member, the role ids they hold (for the live "resolves to" count). */
  members: { roleIds: string[] }[];
  scope: ComposerScope;
  draft?: ComposerDraft;
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
  const [mode, setMode] = React.useState<"everyone" | "roles">(
    draft?.mode ?? (scope.canTargetEveryone ? "everyone" : "roles"),
  );
  const [roleIds, setRoleIds] = React.useState<string[]>(draft?.roleIds ?? []);
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
  const base = `/camps/${slug}/announcements`;

  // The live count EXCLUDES nobody the server would include except the author
  // themselves (who never receives their own announcement) — so it may read
  // one high for an author inside their own audience. It is a guide; the
  // publish result states the real number.
  const resolvedCount = React.useMemo(() => {
    if (mode === "everyone") return members.length;
    if (roleIds.length === 0) return 0;
    const wanted = new Set(roleIds);
    return members.filter((m) => m.roleIds.some((id) => wanted.has(id))).length;
  }, [mode, roleIds, members]);

  function payload() {
    return {
      slug,
      id: draft?.id,
      title,
      bodyMd,
      mode,
      roleIds: mode === "roles" ? roleIds : [],
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
          <div className="flex gap-2">
            {(["everyone", "roles"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                disabled={m === "everyone" && !scope.canTargetEveryone}
                onClick={() => setMode(m)}
                className={optionButton(mode === m)}
              >
                {m === "everyone" ? "Everyone in this camp" : "By role"}
              </button>
            ))}
          </div>
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
          <p className="text-sm text-muted-foreground">
            Reaches about{" "}
            <span className="font-semibold text-foreground">
              {resolvedCount} {resolvedCount === 1 ? "member" : "members"}
            </span>{" "}
            right now — current members only, never pending invitees.
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
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <p className="text-sm text-foreground">
            Once published, an announcement can&apos;t be edited or deleted. If
            you need answers from people, send a questionnaire instead.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save(true)} disabled={pending}>
            <Send className="h-4 w-4" aria-hidden />
            {sendAtLocal ? "Schedule announcement" : "Publish announcement"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => save(false)}
            disabled={pending}
          >
            Save draft
          </Button>
          {draft && (
            <Button variant="ghost" onClick={remove} disabled={pending}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete draft
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Megaphone, Save, Send } from "lucide-react";
import type { AudienceSpec } from "@quagga/types";
import { BulletinComposeInput } from "@quagga/types";
import { AudienceSelect } from "@quagga/ui/components/audience-select";
import { BulletinCard } from "@quagga/ui/components/bulletin-card";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { MarkdownEditor } from "@quagga/ui/components/markdown-editor/markdown-editor";
import { NotificationItem } from "@quagga/ui/components/notification-item";
import { Switch } from "@quagga/ui/components/switch";
import { toast } from "@quagga/ui/components/toast";

import { saveBulletin } from "@/lib/actions/bulletins";
import { previewBulletinAudienceCount } from "./audience-count";
import {
  BULLETIN_AUDIENCE_OPTIONS,
  audienceCountNoun,
  audienceSpecForOption,
  optionForAudienceSpec,
} from "./audience-options";
import { plainPreview } from "./preview-text";

// Bulletin compose / edit form (canvas `U8CqE` · mobile `zW1uE`).
//
// FEWER-FORMS LAW: title + body + audience + optional pin. Nothing else — a
// bulletin never collects data, which is exactly what the informational-only
// callout tells the author. Anything that needs an answer is a questionnaire.
//
// The audience count comes from the SAME server resolver questionnaires use
// (previewBulletinAudienceCount → @quagga/core resolveAudience); this form
// never counts anything itself. It calls the BULLETINS-domain preview and not
// the questionnaire flow's `previewAudienceCount`, which gates on the
// questionnaires domain: a Bulletins-department author was refused their own
// audience count, in a message naming a department that owns a different
// screen, while Publish — correctly gated on `bulletins` — stayed armed.
// Saving/publishing goes through `saveBulletin`, which re-validates with Zod
// and re-checks the audience authz server-side; the disabled button here is
// convenience, never the security boundary.

export interface BulletinComposerProps {
  editionId: string;
  editionName: string;
  /** Present when editing an existing bulletin. */
  bulletin?: {
    id: string;
    title: string;
    bodyMd: string;
    audience: AudienceSpec;
    pinned: boolean;
    /** Published bulletins can be corrected but never re-fanned-out. */
    published: boolean;
  };
}

interface ResolveState {
  loading: boolean;
  count: number | null;
  error: string | null;
}

export function BulletinComposer({
  editionId,
  editionName,
  bulletin,
}: BulletinComposerProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState(bulletin?.title ?? "");
  const [bodyMd, setBodyMd] = React.useState(bulletin?.bodyMd ?? "");
  const [audienceValue, setAudienceValue] = React.useState<string | undefined>(
    optionForAudienceSpec(bulletin?.audience),
  );
  const [pinned, setPinned] = React.useState(bulletin?.pinned ?? false);
  const [resolved, setResolved] = React.useState<ResolveState>({
    loading: false,
    count: null,
    error: null,
  });

  const spec = audienceValue ? audienceSpecForOption(audienceValue) : null;
  const specKey = spec ? JSON.stringify(spec) : "";

  // Live resolved-recipient count — re-resolves whenever the audience changes.
  React.useEffect(() => {
    if (!specKey) {
      setResolved({ loading: false, count: null, error: null });
      return;
    }
    let cancelled = false;
    setResolved((prev) => ({ ...prev, loading: true, error: null }));
    const timer = setTimeout(async () => {
      const result = await previewBulletinAudienceCount({
        audience: JSON.parse(specKey) as AudienceSpec,
        editionId,
      });
      if (cancelled) return;
      setResolved(
        result.ok
          ? { loading: false, count: result.count, error: null }
          : { loading: false, count: null, error: result.error },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [specKey, editionId]);

  const audienceLabel =
    BULLETIN_AUDIENCE_OPTIONS.find((o) => o.value === audienceValue)?.label ??
    "Audience";

  function submit(publish: boolean) {
    if (!spec) {
      toast.error("Pick an audience", {
        description: "A bulletin has to know who it is going to.",
      });
      return;
    }
    const parsed = BulletinComposeInput.safeParse({
      title,
      bodyMd,
      audience: spec,
      pinned,
      publish,
    });
    if (!parsed.success) {
      toast.error("Check the bulletin", {
        description: parsed.error.issues[0]?.message ?? "Something is missing.",
      });
      return;
    }

    startTransition(async () => {
      const result = await saveBulletin({
        ...parsed.data,
        ...(bulletin ? { id: bulletin.id } : {}),
      });
      if (!result.ok) {
        toast.error(publish ? "Could not publish" : "Could not save", {
          description: result.error,
        });
        return;
      }
      toast.success(
        publish
          ? "Bulletin published."
          : bulletin
            ? "Bulletin saved."
            : "Draft saved.",
        publish
          ? { description: `Sent to ${audienceLabel.toLowerCase()}.` }
          : undefined,
      );
      router.push("/bulletins");
      router.refresh();
    });
  }

  const previewTitle = title.trim() || "Untitled bulletin";
  const preview = plainPreview(bodyMd, 180);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-5 p-5">
            <Field
              label="Title"
              htmlFor="bulletin-title"
              required
              help="Keep it short — this becomes the notification headline."
            >
              <Input
                id="bulletin-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ticket resale window opens 1 March"
                aria-describedby="bulletin-title-help"
              />
            </Field>

            <Field
              label="Body"
              htmlFor="bulletin-body"
              required
              help="Markdown supported — bold, italic, links, lists."
            >
              <MarkdownEditor
                value={bodyMd}
                onChange={setBodyMd}
                ariaLabel="Bulletin body"
              />
            </Field>

            <Field
              label="Audience"
              htmlFor="bulletin-audience"
              required
              help="Resolved live by the same rules questionnaires use."
              error={resolved.error ?? undefined}
            >
              <AudienceSelect
                id="bulletin-audience"
                options={BULLETIN_AUDIENCE_OPTIONS}
                value={audienceValue}
                onValueChange={setAudienceValue}
                resolvedCount={resolved.loading ? null : resolved.count}
                countNoun={audienceCountNoun(audienceValue)}
              />
            </Field>

            {/* The pin's copy describes what the pin ACTUALLY does. It used to
                promise "a banner on recipient dashboards until dismissed", and
                both halves were wrong: the only banner in the product is on the
                burner camp dashboard (apps/web `/camps/[slug]`), and it carries
                no ✕ — PinnedBulletinBanner renders one only when handed an
                `onDismiss`, which its single call site does not pass. Suppliers
                and org staff have no banner at all; a pin shows on their
                bulletin page as a "Pinned" marker. Unpinning is here: switch it
                off and save, which works on a published bulletin too. */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  Pin to camp dashboards
                </span>
                <p className="max-w-md text-xs text-muted-foreground">
                  Pinned bulletins sit in a banner at the top of a recipient&rsquo;s
                  camp dashboard until you unpin them here — readers cannot
                  dismiss it. Suppliers and org staff get no banner; the pin
                  just shows on their copy of the bulletin.
                </p>
              </div>
              <Switch
                checked={pinned}
                onCheckedChange={setPinned}
                aria-label="Pin to camp dashboards"
                className="mt-1"
              />
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-accent/40 bg-accent/10 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p className="text-sm text-foreground">
                Bulletins are informational only — if you need answers or data,
                send a questionnaire instead.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {bulletin?.published
              ? "Already published — edits correct the copy; recipients are not notified again."
              : `Publishing resolves the audience now and notifies everyone it matches for ${editionName}.`}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() => submit(false)}
              disabled={pending}
            >
              <Save aria-hidden />
              {bulletin?.published ? "Save changes" : "Save draft"}
            </Button>
            {bulletin?.published ? null : (
              <Button onClick={() => submit(true)} disabled={pending || !spec}>
                <Send aria-hidden />
                {pending ? "Working…" : "Publish bulletin"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Preview — how recipients see it
        </p>
        <Card>
          <CardContent className="p-1">
            <NotificationItem
              kind="bulletin"
              title={previewTitle}
              timeAgo="Just now"
              source="AfrikaBurn"
            />
          </CardContent>
        </Card>
        <BulletinCard
          title={previewTitle}
          preview={preview || "Your bulletin body appears here."}
          audience={audienceValue ? audienceLabel : undefined}
          meta="From AfrikaBurn · Just now"
          pinned={pinned}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Megaphone className="h-3.5 w-3.5" aria-hidden />
          Recipients read it in their inbox and on the bulletin page.
        </p>
      </aside>
    </div>
  );
}

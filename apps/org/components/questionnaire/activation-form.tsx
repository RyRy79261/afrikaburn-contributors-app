"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, Send, ShieldCheck, Users } from "lucide-react";
import {
  ORG_OUTBOUND_SELECTORS,
  ORG_OUTBOUND_SELECTOR_LABELS,
  OFFICER_KEYS,
  OFFICER_AUDIENCE_LABELS,
  type AudienceSpec,
  type OfficerKey,
  type OrgOutboundSelector,
} from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import {
  activateQuestionnaire,
  previewAudienceCount,
} from "@/lib/questionnaires/actions";

type AudienceMode = "org_internal" | "org_outbound" | "org_officer";

interface ActivationFormProps {
  questionnaireKey: string;
  version: string;
  title: string;
  description: string | null;
  editionId: string;
  editionName: string;
  /** Send options carried over from the builder's rail (optional; the author
   * still confirms everything here — this only pre-fills the form). */
  initialAudience?: AudienceSpec | null;
  initialBlocking?: boolean;
  initialDueAt?: string;
}

function buildSpec(
  mode: AudienceMode,
  selectors: OrgOutboundSelector[],
  officerKeys: OfficerKey[],
): AudienceSpec | null {
  if (mode === "org_internal") return { kind: "org_internal" };
  if (mode === "org_officer") {
    if (officerKeys.length === 0) return null;
    return { kind: "org_officer", officerKeys };
  }
  if (selectors.length === 0) return null;
  return { kind: "org_outbound", selectors };
}

export function ActivationForm({
  questionnaireKey,
  version,
  title,
  description,
  editionId,
  editionName,
  initialAudience,
  initialBlocking,
  initialDueAt,
}: ActivationFormProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [mode, setMode] = React.useState<AudienceMode>(
    initialAudience && initialAudience.kind !== "project"
      ? initialAudience.kind
      : "org_outbound",
  );
  const [selectors, setSelectors] = React.useState<OrgOutboundSelector[]>(
    initialAudience?.kind === "org_outbound" ? initialAudience.selectors : [],
  );
  const [officerKeys, setOfficerKeys] = React.useState<OfficerKey[]>(
    initialAudience?.kind === "org_officer" ? initialAudience.officerKeys : [],
  );
  const [blocking, setBlocking] = React.useState(initialBlocking ?? false);
  const [dueAt, setDueAt] = React.useState(initialDueAt ?? "");

  const [preview, setPreview] = React.useState<{
    loading: boolean;
    count: number | null;
    error: string | null;
  }>({ loading: false, count: null, error: null });

  const spec = buildSpec(mode, selectors, officerKeys);
  const specKey = spec ? JSON.stringify(spec) : "";

  // LIVE resolved-count preview — re-resolve whenever the audience changes.
  React.useEffect(() => {
    if (!spec) {
      setPreview({ loading: false, count: null, error: null });
      return;
    }
    let cancelled = false;
    setPreview((p) => ({ ...p, loading: true, error: null }));
    const t = setTimeout(async () => {
      const result = await previewAudienceCount({ audience: spec, editionId });
      if (cancelled) return;
      if (result.ok) {
        setPreview({ loading: false, count: result.count, error: null });
      } else {
        setPreview({ loading: false, count: null, error: result.error });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [specKey, editionId]);

  function toggleSelector(s: OrgOutboundSelector) {
    setSelectors((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function toggleOfficer(k: OfficerKey) {
    setOfficerKeys((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  function send() {
    if (!spec) {
      toast.error("Pick an audience", {
        description: "Choose at least one outbound audience.",
      });
      return;
    }
    startTransition(async () => {
      const result = await activateQuestionnaire({
        questionnaireKey,
        version,
        title,
        description: description ?? undefined,
        editionId,
        audience: spec,
        blocking,
        dueAt: dueAt ? dueAt : null,
      });
      if (result.ok) {
        toast.success("Questionnaire sent.");
        router.push("/questionnaires");
        router.refresh();
      } else {
        toast.error("Could not send", { description: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Audience</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <AudienceModeCard
              active={mode === "org_internal"}
              icon={<Building2 className="h-4 w-4" aria-hidden />}
              title="Org members (internal)"
              caption="Shows only in this console. Gates staff who haven't answered."
              onClick={() => setMode("org_internal")}
            />
            <AudienceModeCard
              active={mode === "org_outbound"}
              icon={<Users className="h-4 w-4" aria-hidden />}
              title="Outbound"
              caption="Delivered to burners in the participant app."
              onClick={() => setMode("org_outbound")}
            />
            <AudienceModeCard
              active={mode === "org_officer"}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
              title="Officers"
              caption="Brief the responsible people across all registered camps."
              onClick={() => setMode("org_officer")}
            />
          </div>

          {mode === "org_outbound" && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Send to</span>
              <div className="flex flex-wrap gap-2">
                {ORG_OUTBOUND_SELECTORS.map((s) => {
                  const on = selectors.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSelector(s)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        on
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {on && <Check className="h-3.5 w-3.5 text-accent" />}
                      {ORG_OUTBOUND_SELECTOR_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === "org_officer" && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Officer roles</span>
              <p className="text-xs text-muted-foreground">
                Resolves to every accepted officer of these roles across
                registered camps, whatever each camp calls them.
              </p>
              <div className="flex flex-wrap gap-2">
                {OFFICER_KEYS.map((k) => {
                  const on = officerKeys.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleOfficer(k)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        on
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {on && <Check className="h-3.5 w-3.5 text-accent" />}
                      {OFFICER_AUDIENCE_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <AudiencePreview preview={preview} hasSpec={spec !== null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Blocking</span>
              <p className="max-w-md text-xs text-muted-foreground">
                A blocking questionnaire is a hard gate — recipients can do
                nothing else until they submit. Leave off for a dashboard banner
                that never impedes navigation.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={blocking}
              onClick={() => setBlocking((b) => !b)}
              className={cn(
                "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                blocking ? "bg-destructive" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background transition-transform",
                  blocking ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          <div>
            <BlockingBadge blocking={blocking} />
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Due date (optional)</span>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="max-w-xs"
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Sending resolves the audience now and notifies everyone it matches for{" "}
          {editionName}.
        </p>
        <Button onClick={send} disabled={pending || !spec}>
          <Send aria-hidden />
          {pending ? "Sending…" : "Send questionnaire"}
        </Button>
      </div>
    </div>
  );
}

function AudienceModeCard({
  active,
  icon,
  title,
  caption,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors",
        active
          ? "border-accent bg-accent/10"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
        {active && <Check className="ml-auto h-4 w-4 text-accent" />}
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </button>
  );
}

function AudiencePreview({
  preview,
  hasSpec,
}: {
  preview: { loading: boolean; count: number | null; error: string | null };
  hasSpec: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
      {!hasSpec ? (
        <span className="text-muted-foreground">
          Pick an audience to see how many people it reaches.
        </span>
      ) : preview.loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
          <span className="text-muted-foreground">Resolving audience…</span>
        </>
      ) : preview.error ? (
        <span className="text-destructive">{preview.error}</span>
      ) : (
        <>
          <Users className="h-4 w-4 text-accent" aria-hidden />
          <span>
            <span className="font-semibold tabular-nums">{preview.count}</span>{" "}
            {preview.count === 1 ? "person" : "people"} will receive this right
            now.
          </span>
        </>
      )}
    </div>
  );
}

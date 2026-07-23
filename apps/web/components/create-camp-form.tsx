"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import {
  CAMP_DESCRIPTION_WORD_LIMIT,
  wordsRemaining,
} from "@quagga/core";
import type { GroupKind, Joinability } from "@quagga/types";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
import type { CreateCampActionResult } from "@/app/camps/new/actions";

const KINDS: { value: Exclude<GroupKind, "org">; label: string }[] = [
  { value: "theme_camp", label: "Theme camp" },
  { value: "artwork", label: "Artwork" },
  { value: "mutant_vehicle", label: "Mutant vehicle" },
];

interface CreateCampFormProps {
  action: (raw: unknown) => Promise<CreateCampActionResult>;
}

export function CreateCampForm({ action }: CreateCampFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Exclude<GroupKind, "org">>("theme_camp");
  const [description, setDescription] = React.useState("");
  const [joinability, setJoinability] = React.useState<Joinability>("open");
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const remaining = wordsRemaining(description, CAMP_DESCRIPTION_WORD_LIMIT);
  const overLimit = remaining < 0;
  const awaitingConfirm = warnings.length > 0;

  function submit(confirmWarnings: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await action({
        name,
        kind,
        description: description.trim() || undefined,
        joinability,
        confirmWarnings,
      });
      if (result.status === "created") {
        router.push(`/camps/${result.slug}`);
      } else if (result.status === "warn") {
        setWarnings(result.warnings);
      } else {
        setError(result.message);
        setWarnings([]);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(awaitingConfirm);
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Camp name <span className="text-primary">*</span>
        </label>
        <Input
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setWarnings([]);
          }}
          placeholder="e.g. Neon Cathedral"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Kind</span>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm transition-colors",
                kind === k.value
                  ? "border-primary bg-primary/10"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <span
            className={cn(
              "text-xs",
              overLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {overLimit
              ? `${Math.abs(remaining)} over`
              : `${remaining} words left`}
          </span>
        </div>
        <Textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What your camp brings to the Tankwa. Up to 60 words."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Who can join</span>
        <div className="flex gap-2">
          {(
            [
              { value: "open", label: "Anyone can join" },
              { value: "invite_only", label: "Invite-only" },
            ] as const
          ).map((j) => (
            <button
              key={j.value}
              type="button"
              aria-pressed={joinability === j.value}
              onClick={() => setJoinability(j.value)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                joinability === j.value
                  ? "border-primary bg-primary/10"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {j.label}
            </button>
          ))}
        </div>
      </div>

      {awaitingConfirm && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <div>
            <p className="font-medium text-foreground">Similar names exist</p>
            <p className="mt-0.5 text-muted-foreground">
              {warnings.join(", ")}. If yours is different, create it anyway.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          disabled={isPending || overLimit || name.trim().length < 2}
        >
          {isPending
            ? "Creating…"
            : awaitingConfirm
              ? "Create anyway"
              : "Create camp"}
        </Button>
      </div>
    </form>
  );
}

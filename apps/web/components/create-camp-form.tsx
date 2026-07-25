"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { CAMP_DESCRIPTION_WORD_LIMIT, wordsRemaining } from "@quagga/core";
import type { Joinability } from "@quagga/types";
import { Input } from "@quagga/ui/components/input";
import { TextareaWithCount } from "@quagga/ui/components/textarea-with-count";
import { Button } from "@quagga/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import type { CreateCampActionResult } from "@/app/camps/new/actions";

interface CreateCampFormProps {
  action: (raw: unknown) => Promise<CreateCampActionResult>;
}

const JOINABILITY_HELP: Record<Joinability, string> = {
  open: "Anyone can request to join. Switch to invite-only whenever you like — it's a directory badge, not a lock.",
  invite_only:
    "Only people with an invite link can join. Open it up whenever you like — it's a directory badge, not a lock.",
};

export function CreateCampForm({ action }: CreateCampFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
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
      {/* 1 — Camp name (with soft dedupe feedback) */}
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
          placeholder="e.g. Mad Hatters Tea Co."
          required
        />
        {awaitingConfirm && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Similar to existing camp &ldquo;{warnings[0]}&rdquo; — is yours
              different? You can still use this name.
            </span>
          </p>
        )}
      </div>

      {/* 2 — Short description (word-counted) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Short description
        </label>
        <TextareaWithCount
          id="description"
          rows={4}
          maxWords={CAMP_DESCRIPTION_WORD_LIMIT}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What your camp brings to the Tankwa. Up to 60 words."
        />
      </div>

      {/* 3 — Joinability */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="joinability" className="text-sm font-medium">
          Joinability
        </label>
        <Select
          value={joinability}
          onValueChange={(v) => setJoinability(v as Joinability)}
        >
          <SelectTrigger id="joinability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Accepting new members</SelectItem>
            <SelectItem value="invite_only">Invite-only</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {JOINABILITY_HELP[joinability]}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted-foreground">
          Free to create · no approval needed
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/directory">Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={isPending || overLimit || name.trim().length < 2}
          >
            {isPending ? "Creating…" : "Create camp"}
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        That&rsquo;s the whole form. Really.
      </p>
    </form>
  );
}

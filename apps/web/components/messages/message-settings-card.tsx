"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";
import {
  DISAPPEARING_MESSAGES_NOTE,
  MESSAGE_TIMERS,
  MESSAGE_TIMER_LABELS,
  type MessageTimer,
} from "@quagga/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { toast } from "@quagga/ui/components/toast";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Epic #69 — the member's personal default disappearing-messages timer, on
 * /profile. Applied to new conversations they start; either participant can
 * change a conversation's own timer afterwards. NEEDS DESIGN REVIEW.
 */
export function MessageSettingsCard({
  timer,
  save,
}: {
  timer: MessageTimer;
  save: (input: { timer: MessageTimer }) => Promise<Result>;
}) {
  const [value, setValue] = React.useState<MessageTimer>(timer);
  const [busy, setBusy] = React.useState(false);

  async function change(next: MessageTimer) {
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const result = await save({ timer: next });
      if (!result.ok) {
        setValue(prev);
        toast.error(result.error);
      } else {
        toast.success("Default timer saved.");
      }
    } catch {
      setValue(prev);
      toast.error("That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-primary" aria-hidden />
          Messages
        </CardTitle>
        <CardDescription>
          Who can message you is the &ldquo;Who can contact you&rdquo; setting
          above. This is how long messages last in chats you start.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p id="default-timer-label" className="text-sm font-medium">
            Default disappearing-messages timer
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={value}
            disabled={busy}
            onValueChange={(v) => {
              const next = MESSAGE_TIMERS.find((t) => t === v);
              if (next && next !== value) void change(next);
            }}
            aria-labelledby="default-timer-label"
          >
            {MESSAGE_TIMERS.map((t) => (
              <ToggleGroupItem
                key={t}
                value={t}
                aria-label={`Default timer: ${MESSAGE_TIMER_LABELS[t]}`}
                className="text-xs"
              >
                {MESSAGE_TIMER_LABELS[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <p className="text-xs text-muted-foreground">
          {DISAPPEARING_MESSAGES_NOTE}
        </p>
      </CardContent>
    </Card>
  );
}

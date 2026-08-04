import * as React from "react";
import { Megaphone, Pin } from "lucide-react";
import { Card, CardContent } from "./card";
import { Badge } from "./badge";
import { cn } from "../lib/utils";
import { readRate } from "../lib/bulletin";

// BulletinCard — an org broadcast rendered as a card (canvas `fulVI`). Used in
// two places: the participant/recipient bulletin lists (title + preview + meta +
// audience) and the org Bulletins list, where `readRate` additionally shows a
// "n of m read · p%" bar. Presentational (no hooks) → server-component-safe.
//
// Fewer-forms / never-payments laws are upstream concerns (a bulletin is only
// title + body + audience + optional pin); this component just displays them.

export interface BulletinCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: React.ReactNode;
  /** Body preview (2-line clamped). Pass an already-plain/safe string. */
  preview?: React.ReactNode;
  /** Audience label for the chip, e.g. "All camp leads". */
  audience?: React.ReactNode;
  /** Footer meta, e.g. "Sent 12 Feb 2027" or "Draft". */
  meta?: React.ReactNode;
  /** Pinned bulletins show a pin in the kicker row. */
  pinned?: boolean;
  /** Org list only: read counts → renders the read-rate bar. */
  readRate?: { read: number; of: number };
}

export function BulletinCard({
  title,
  preview,
  audience,
  meta,
  pinned = false,
  readRate: readRateProp,
  className,
  ...props
}: BulletinCardProps) {
  const rate = readRateProp
    ? readRate(readRateProp.read, readRateProp.of)
    : null;

  return (
    <Card className={cn("overflow-hidden", className)} {...props}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Megaphone className="h-3.5 w-3.5" aria-hidden />
            Bulletin
          </span>
          {pinned ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
              title="Pinned"
            >
              <Pin className="h-3.5 w-3.5" aria-hidden />
              Pinned
            </span>
          ) : null}
        </div>

        <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
          {title}
        </h3>

        {preview ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {preview}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {meta ? (
            <p className="text-xs text-muted-foreground">{meta}</p>
          ) : (
            <span />
          )}
          {audience ? (
            <Badge variant="outline" className="shrink-0">
              {audience}
            </Badge>
          ) : null}
        </div>

        {rate ? (
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {rate.read} of {rate.of} read
              </span>
              <span className="tabular-nums">{rate.percent}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={rate.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Read rate"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${rate.percent}%` }}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

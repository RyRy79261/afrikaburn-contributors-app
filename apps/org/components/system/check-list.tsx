import type { ReactNode } from "react";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import type { CheckTone, SystemCheck } from "@/lib/system-status";

// The System panel's one repeated shape: state, then the reason for it.
//
// A definition list rather than a data table, because the load-bearing content
// here is the SENTENCE, not the value. A table would give every check a narrow
// column and push the explanation into a tooltip nobody opens — and the
// explanation is the entire reason this page exists. The badge answers "is this
// fine?" at a glance; the paragraph answers "so what do I do?".
//
// Server component: nothing here is interactive, so none of this copy ships as
// client JavaScript.

/**
 * Tone → badge. Only `attention` is amber, deliberately.
 *
 * A deployment with no email provider and no blob token is working exactly as
 * designed, with honest fallbacks in place. Painting that amber would put this
 * page permanently in a warning state, and a page that always warns is a page
 * nobody reads — so "deliberately unconfigured" is muted and only a genuine
 * misconfiguration is loud.
 */
const TONE_VARIANT: Record<
  CheckTone,
  "success" | "secondary" | "warning" | "outline"
> = {
  ok: "success",
  degraded: "secondary",
  attention: "warning",
  info: "outline",
};

/** Screen-reader prefix, so the badge is not a colour-only signal. */
const TONE_LABEL: Record<CheckTone, string> = {
  ok: "Healthy:",
  degraded: "Not configured:",
  attention: "Needs attention:",
  info: "For information:",
};

export function CheckRow({ check }: { check: SystemCheck }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border py-4 last:border-b-0 last:pb-0 first:pt-0 sm:flex-row sm:gap-6">
      <dt className="flex w-full shrink-0 flex-col gap-1.5 sm:w-56">
        <span className="text-sm font-medium text-foreground">
          {check.label}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={TONE_VARIANT[check.tone]}>
            <span className="sr-only">{TONE_LABEL[check.tone]} </span>
            {check.value}
          </Badge>
        </span>
      </dt>
      <dd className="flex flex-1 flex-col gap-1.5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {check.detail}
        </p>
        {check.env && check.env.length > 0 && (
          /* NAMES only. Which variable decides this is the actionable half —
             its value is never printed here or anywhere else on the page. */
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground/70">
            {check.env.join(" · ")}
          </p>
        )}
      </dd>
    </div>
  );
}

export function CheckListCard({
  title,
  description,
  checks,
  footer,
}: {
  title: string;
  description: string;
  checks: SystemCheck[];
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </dl>
        {footer}
      </CardContent>
    </Card>
  );
}

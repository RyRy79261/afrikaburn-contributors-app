import { notFound } from "next/navigation";
import {
  OfficerKey,
  OrgOutboundSelector,
  type AudienceSpec,
} from "@quagga/types";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { ActivationForm } from "@/components/questionnaire/activation-form";
import { getActiveEdition } from "@/lib/queries";
import { getOrgDefinition } from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

/**
 * The builder's send rail hands its choices over in the query string. Parse
 * them defensively — an unrecognised value simply pre-fills nothing. The
 * activation itself is authorised and resolved server-side as always.
 */
function parseAudienceParam(raw: string | undefined): AudienceSpec | null {
  if (!raw) return null;
  if (raw === "internal") return { kind: "org_internal" };
  if (raw.startsWith("outbound:")) {
    const parsed = OrgOutboundSelector.safeParse(raw.slice("outbound:".length));
    return parsed.success
      ? { kind: "org_outbound", selectors: [parsed.data] }
      : null;
  }
  if (raw.startsWith("officer:")) {
    const parsed = OfficerKey.safeParse(raw.slice("officer:".length));
    return parsed.success
      ? { kind: "org_officer", officerKeys: [parsed.data] }
      : null;
  }
  return null;
}

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActivateQuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { key } = await params;
  const query = await searchParams;
  const [definition, edition] = await Promise.all([
    getOrgDefinition(key),
    getActiveEdition(),
  ]);
  if (!definition) notFound();

  const initialAudience = parseAudienceParam(firstParam(query.audience));
  const initialBlocking = firstParam(query.blocking) === "1";
  const dueParam = firstParam(query.due);
  const initialDueAt =
    dueParam && /^\d{4}-\d{2}-\d{2}$/.test(dueParam) ? dueParam : undefined;

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / Send"
        title={definition.title}
        description={
          definition.description ??
          "Choose an audience and delivery options, then send."
        }
      />

      {!edition ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active edition is seeded yet — a questionnaire can only be sent
            against an active edition.
          </CardContent>
        </Card>
      ) : (
        <ActivationForm
          questionnaireKey={definition.key}
          version={definition.version ?? "1"}
          title={definition.title}
          description={definition.description}
          editionId={edition.id}
          editionName={edition.name}
          initialAudience={initialAudience}
          initialBlocking={initialBlocking}
          initialDueAt={initialDueAt}
        />
      )}
    </div>
  );
}

import { ShieldAlert } from "lucide-react";
import {
  DEPARTMENT_SCOPE_NOTE,
  ENGINEER_RANK_CARVE_OUTS,
  ORG_CAPABILITY_CONSEQUENCES,
  ORG_CAPABILITY_LABELS,
  ORG_RANK_LABELS,
  grantScopeClause,
  orgPermissionsFromKeys,
  summarizeOrgActor,
  type OrgCapability,
  type OrgDomain,
  type OrgRank,
} from "@quagga/core";
import { cn } from "@quagga/ui/lib/utils";

// "WHAT CAN THIS PERSON ACTUALLY DO?" — rendered once, read everywhere.
//
// The accounts table, the assignment dialog's live preview and the role editor
// all answer that question, and all three answer it with THIS component over the
// output of `summarizeOrgActor`. One renderer is the point: a reviewer who reads
// "cannot delete anything" on the accounts screen and "permanently removes
// suppliers" in the dialog would have no way to know which one to believe.
//
// DELETION GETS ITS OWN LINE, ALWAYS — including when the answer is "nothing".
// A reviewer must be able to answer "what can this person delete?" from the row
// in front of them without opening another page, and a capability that is simply
// absent from a list is indistinguishable from one nobody thought about.
//
// THAT LINE NAMES THE VERB AND LETS THE SCOPE NAME THE PLACE. It used to read
// "can permanently remove suppliers and their documents" for every grant of
// `delete`, which was written when the two supplier actions were the only ones
// asking for it. Departments own the whole console now, so a Theme camps lead
// was being told they could destroy suppliers they cannot touch — and, worse,
// told nothing about the registrations they can. The domain list is the only
// honest answer to "where", and `grantScopeClause` already produces it.
//
// A SCOPED GRANT NAMES THE DOMAINS, NOT JUST THE DEPARTMENT. "Can delete, in
// Safety only" is not an answer if Safety owns nothing — it reads as access and
// is none. Every scope clause therefore comes from `grantScopeClause`, which
// says the parts of the console the grant reaches or says out loud that it
// reaches nothing.

/** A resolved capability, the departments it is confined to (null = everywhere),
 * and the parts of the console those departments actually own. */
export interface CapabilityGrantView {
  capability: OrgCapability;
  departments: string[] | null;
  /** Null when org-wide; EMPTY when the departments own no part of the console. */
  domains: OrgDomain[] | null;
  /**
   * TRUE when this is one of the grants the `engineer` RANK never resolves
   * (`ENGINEER_RANK_CARVE_OUTS`) and the preview was NOT told whose account it
   * is for — so this line is the org staff answer, and an engineer target would
   * be refused exactly this one however the roles are written.
   *
   * Only `grantsForRoles` sets it, and only when its caller omitted the rank.
   * The server's `summarizeOrgActor` resolves the real actor, rank included, so
   * a grant that came from there is already exact and never carries this.
   */
  engineerCeilingUnchecked?: boolean;
}

/** A role as the previewing surfaces hold it: its scope, what its department
 * owns, and what it grants. */
export interface PreviewRole {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
  /** The domains that role's DEPARTMENT owns — empty for an org-wide role, and
   * empty (meaningfully) for a department that has been given nothing. */
  departmentDomains?: readonly OrgDomain[];
  capabilities: readonly OrgCapability[];
}

/**
 * The union a set of roles WOULD resolve to — the same arithmetic
 * `resolveAccountCapabilities` does on the server, run in the browser so the
 * assignment dialog and the role editor can show the consequence of a draft
 * BEFORE it is saved.
 *
 * Nothing here is a security decision: the action re-checks server-side and
 * `orgCan` refuses `manage_accounts` to every role however this is called. It
 * exists so the console cannot promise access it would then refuse.
 *
 * PASS THE TARGET ACCOUNT'S RANK WHENEVER THERE IS A TARGET ACCOUNT. The rank
 * used to be hardcoded to `org_staff` here on the grounds that it is only the
 * door — which stopped being true when personal information and deletion became
 * `ENGINEER_RANK_CARVE_OUTS`. An engineer resolves neither, however their roles
 * are written, so previewing an engineer's assignment as `org_staff` promised
 * two grants the resolver ALWAYS refuses: the dialog said "can permanently
 * destroy records" about an account that cannot delete anything anywhere.
 *
 * OMIT IT ONLY WHERE THERE IS NO ACCOUNT. The role editor asks "what does this
 * ROLE SET grant?", a question with no person in it, and answers it as
 * `org_staff` — the door with no ceiling on it. When the rank is omitted the
 * carve-out grants come back flagged (`engineerCeilingUnchecked`) and
 * `CapabilitySummary` names which of them an engineer would be refused, so an
 * un-ranked preview is never read as a promise about a specific person.
 */
export function grantsForRoles(
  roles: readonly PreviewRole[],
  /** The rank of the account this preview is FOR; omitted where there is none. */
  rank?: OrgRank,
): CapabilityGrantView[] {
  const names = new Map(
    roles
      .filter((r) => r.departmentId !== null && r.departmentName !== null)
      .map((r) => [r.departmentId as string, r.departmentName as string]),
  );
  // The ownership map, rebuilt from what these roles' departments own, so the
  // preview resolves scope exactly as the server does.
  const domains: Record<string, { id: string; name: string }> = {};
  for (const r of roles) {
    if (!r.departmentId) continue;
    for (const domain of r.departmentDomains ?? []) {
      domains[domain] = {
        id: r.departmentId,
        name: r.departmentName ?? "a department",
      };
    }
  }
  return summarizeOrgActor({
    rank: rank ?? "org_staff",
    domains,
    roles: roles.map((r) => ({
      id: r.id,
      key: r.id,
      name: r.id,
      kind: "custom" as const,
      departmentId: r.departmentId,
      permissions: orgPermissionsFromKeys([...r.capabilities]),
    })),
  }).map((grant) => ({
    capability: grant.capability,
    departments:
      grant.departmentIds?.map((id) => names.get(id) ?? "a department") ?? null,
    domains: grant.domains,
    engineerCeilingUnchecked:
      rank === undefined && ENGINEER_RANK_CARVE_OUTS.includes(grant.capability),
  }));
}

function scopeClause(grant: CapabilityGrantView): string {
  return grantScopeClause(grant, grant.departments ?? []);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "delete" · "delete or see personal information" — the carve-outs, named. */
function orList(capabilities: readonly OrgCapability[]): string {
  const labels = capabilities.map((c) =>
    ORG_CAPABILITY_LABELS[c].toLowerCase(),
  );
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

export function CapabilitySummary({
  grants,
  /** What to say when the account resolves nothing at all. */
  emptyLabel = "Nothing yet — can sign in, and the console opens empty.",
  className,
}: {
  grants: readonly CapabilityGrantView[];
  emptyLabel?: string;
  className?: string;
}) {
  const destructive = grants.find((g) => g.capability === "delete");
  const ordinary = grants.filter((g) => g.capability !== "delete");
  // A grant confined to departments that own nothing is the trap this whole
  // change exists to close: it looks granted and reaches nothing. Say so once,
  // under the list, rather than repeating it on every line.
  const reachesNothing = grants.some((g) => g.domains?.length === 0);
  // Resolved without knowing whose account it is, and at least one of the
  // answers depends on that. Named rather than silently averaged: an engineer
  // reading their own assignment preview must not be shown a deletion they can
  // never perform.
  const rankSensitive = grants.filter((g) => g.engineerCeilingUnchecked);

  return (
    <span className={cn("flex flex-col gap-1 text-xs", className)}>
      {ordinary.length === 0 && !destructive ? (
        <span className="italic text-muted-foreground">{emptyLabel}</span>
      ) : (
        ordinary.length > 0 && (
          <span className="text-muted-foreground">
            {sentenceCase(
              ordinary
                .map((g) => {
                  const phrase = ORG_CAPABILITY_CONSEQUENCES[g.capability];
                  return g.departments === null
                    ? phrase
                    : `${phrase} (${scopeClause(g)})`;
                })
                .join(" · "),
            )}
          </span>
        )
      )}

      {destructive ? (
        <span className="flex items-start gap-1.5 font-medium text-destructive">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Can permanently destroy records, {scopeClause(destructive)}.
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          Can delete nothing — no record, in any part of the console.
        </span>
      )}

      {reachesNothing && (
        <span className="text-muted-foreground">{DEPARTMENT_SCOPE_NOTE}</span>
      )}

      {rankSensitive.length > 0 && (
        <span className="text-muted-foreground">
          Read as an {ORG_RANK_LABELS.org_staff.toLowerCase()} account. An{" "}
          {ORG_RANK_LABELS.engineer.toLowerCase()} account is refused{" "}
          {orList(rankSensitive.map((g) => g.capability))} in every department
          however its roles are written, so it would get everything above except{" "}
          {rankSensitive.length === 1 ? "that" : "those"}.
        </span>
      )}
    </span>
  );
}

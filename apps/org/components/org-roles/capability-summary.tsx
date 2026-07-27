import { ShieldAlert } from "lucide-react";
import {
  DEPARTMENT_SCOPE_NOTE,
  ORG_CAPABILITY_CONSEQUENCES,
  grantScopeClause,
  orgPermissionsFromKeys,
  summarizeOrgActor,
  type OrgCapability,
  type OrgDomain,
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
 * The rank is the door and is irrelevant to resolution unless it is `god` — and
 * a god is never a target of these surfaces (the controls are not rendered and
 * both actions refuse a god target), so `org_staff` is the honest stand-in.
 *
 * NOTE ON THE RANK STAND-IN, since PII and delete are now rank-carved-out for
 * engineers: this preview answers "what does this ROLE SET grant?", which is the
 * question a role editor asks. The accounts table does NOT use it — it renders
 * the server's `summarizeOrgActor` over the real actor, rank included — so an
 * engineer is never shown a capability their rank refuses.
 */
export function grantsForRoles(
  roles: readonly PreviewRole[],
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
    rank: "org_staff",
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
  }));
}

function scopeClause(grant: CapabilityGrantView): string {
  return grantScopeClause(grant, grant.departments ?? []);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
            Can permanently remove suppliers and their documents,{" "}
            {scopeClause(destructive)}.
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          Can delete nothing — no suppliers, no documents.
        </span>
      )}

      {reachesNothing && (
        <span className="text-muted-foreground">{DEPARTMENT_SCOPE_NOTE}</span>
      )}
    </span>
  );
}

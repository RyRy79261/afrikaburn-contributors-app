import { ShieldAlert } from "lucide-react";
import {
  DEPARTMENT_SCOPE_TODAY,
  ORG_CAPABILITY_CONSEQUENCES,
  orgPermissionsFromKeys,
  summarizeOrgActor,
  type OrgCapability,
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

/** A resolved capability and the departments it is confined to (null = everywhere). */
export interface CapabilityGrantView {
  capability: OrgCapability;
  departments: string[] | null;
}

/** A role as the previewing surfaces hold it: its scope and what it grants. */
export interface PreviewRole {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
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
 */
export function grantsForRoles(
  roles: readonly PreviewRole[],
): CapabilityGrantView[] {
  const names = new Map(
    roles
      .filter((r) => r.departmentId !== null && r.departmentName !== null)
      .map((r) => [r.departmentId as string, r.departmentName as string]),
  );
  return summarizeOrgActor({
    rank: "org_staff",
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
  }));
}

function scopeClause(departments: string[] | null): string {
  if (departments === null) return "everywhere";
  if (departments.length === 0) return "in no department";
  if (departments.length === 1) return `in ${departments[0]} only`;
  return `in ${departments.slice(0, -1).join(", ")} and ${departments[departments.length - 1]} only`;
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
                    : `${phrase} (${scopeClause(g.departments)})`;
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
            {scopeClause(destructive.departments)}.
            {destructive.departments !== null && (
              <span className="font-normal text-muted-foreground">
                {" "}
                {DEPARTMENT_SCOPE_TODAY}
              </span>
            )}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          Can delete nothing — no suppliers, no documents.
        </span>
      )}
    </span>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Eye,
  Lock,
  Plus,
  Shield,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  DEPARTMENT_SCOPE_NOTE,
  GRANTABLE_ORG_CAPABILITIES,
  ORG_CAPABILITY_DESCRIPTIONS,
  ORG_CAPABILITY_LABELS,
  ORG_DOMAINS,
  ORG_DOMAIN_DESCRIPTIONS,
  ORG_DOMAIN_LABELS,
  ORG_RANK_LABELS,
  canDeleteOrgRoleKind,
  canRescopeOrgRole,
  departmentDomainsNote,
  listDomainLabels,
  type OrgCapability,
  type OrgDomain,
} from "@quagga/core";
import { ROLE_COLORS, type RoleColor } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Checkbox } from "@quagga/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { RoleSwatch } from "@quagga/ui/components/role-badge";
import { Textarea } from "@quagga/ui/components/textarea";
import { toast } from "@quagga/ui/components/toast";

import {
  createDepartment,
  createOrgRole,
  deleteDepartment,
  deleteOrgRole,
  renameDepartment,
  setDepartmentDomains,
  updateOrgRole,
} from "@/lib/actions/org-roles";
import type { DeletionImpact } from "@/lib/org-role-impact";
import type { OrgRolesOverview, OrgRoleView } from "@/lib/queries";
import {
  CapabilitySummary,
  grantsForRoles,
} from "@/components/org-roles/capability-summary";

// THE SYSTEM MANAGER'S ROLES SCREEN.
//
// Client-side only for the forms and dialogs. Every mutation is a server action
// that re-checks the `god` anchor (`requireSystemManager`), so `canManage` here
// decides what is OFFERED and never what is permitted — an engineer reading this
// page with `read_system` sees the model and no controls, and would still be
// refused server-side if they forged the call.
//
// THREE RULES THIS SCREEN IS BUILT AROUND:
//
//  1. Nothing destructive happens without stating who it costs. Deleting a
//     department takes its roles AND everyone's hold on them; the dialog names
//     the people and counts the ones who would be left able to sign in and do
//     nothing. A toast afterwards is not a substitute for a sentence before.
//  2. Permanence is EXPLAINED, never a greyed-out button. A control that is
//     simply missing teaches nobody why.
//  3. Rights are described by CONSEQUENCE. Someone here is deciding what a
//     colleague can destroy, so the checklist says "permanently removes
//     suppliers and their documents", not "delete".
//  4. A DEPARTMENT THAT OWNS NOTHING SAYS SO. Scoping is now two decisions —
//     which department a role belongs to, and what that department owns — and
//     the first is worthless without the second. Every place a scoped role
//     appears, the domains behind it appear with it, including the empty case.

const NO_DEPARTMENT = "__none__";

/** Deleting nothing costs nothing — the shape used before any query answers. */
const NO_IMPACT: DeletionImpact = { people: 0, leftWithNothing: 0, labels: [] };

export interface RoleImpacts {
  byRole: Record<string, DeletionImpact>;
  byDepartment: Record<string, DeletionImpact>;
}

export function RolesManager({
  overview,
  impacts,
  canManage,
}: {
  overview: OrgRolesOverview;
  /** Null for a reader: it carries the affected people's addresses. */
  impacts: RoleImpacts | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<OrgRoleView | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [confirmDeleteDepartment, setConfirmDeleteDepartment] =
    useState<OrgRolesOverview["departments"][number] | null>(null);
  const [confirmDeleteRole, setConfirmDeleteRole] =
    useState<OrgRoleView | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<{
    id: string;
    name: string;
    description: string | null;
  } | null>(null);
  const [editingDomains, setEditingDomains] = useState<{
    id: string;
    name: string;
    domains: OrgDomain[];
  } | null>(null);

  const departments = overview.departments;
  const departmentOptions = departments.map((d) => ({
    id: d.id,
    name: d.name,
    domains: d.domains,
  }));

  // Which department currently owns each domain — so the "what it owns" dialog
  // can say "currently Safety's" beside a checkbox instead of silently taking
  // it. A domain has exactly one owner (primary key on the domain), so claiming
  // one always takes it from somewhere.
  const ownerByDomain = new Map<OrgDomain, string>();
  for (const d of departments) {
    for (const domain of d.domains) ownerByDomain.set(domain, d.name);
  }

  function roleImpact(roleId: string): DeletionImpact {
    return impacts?.byRole[roleId] ?? NO_IMPACT;
  }
  function departmentImpact(departmentId: string): DeletionImpact {
    return impacts?.byDepartment[departmentId] ?? NO_IMPACT;
  }

  function run(
    work: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(done);
        setEditing(null);
        setCreatingRole(false);
        setConfirmDeleteDepartment(null);
        setConfirmDeleteRole(null);
        setEditingDepartment(null);
        setEditingDomains(null);
        setNewDepartment("");
        router.refresh();
      } else {
        toast.error("That didn't work", { description: result.error });
      }
    });
  }

  return (
    <>
      {!canManage && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-foreground">
            You are reading this deployment&rsquo;s permission model, which is
            part of the system panel. Changing it belongs to a{" "}
            {ORG_RANK_LABELS.god.toLowerCase()} alone — and not because the
            buttons are missing: every action here asks for that anchor
            server-side, so it cannot be granted to a role or forged from a
            console.
          </span>
        </p>
      )}

      {/* ORG-WIDE FIRST. These are the roles most people hold and the two that
          carry what `org_staff` and `engineer` meant when they were hardcoded,
          so they are what someone came here to read. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden />
            Org-wide roles
          </CardTitle>
          <CardDescription>
            Roles tied to no department: what they grant, they grant everywhere.
            The two permanent ones carry exactly the rights org staff and
            engineers held when those were hardcoded ranks — and you can change
            either, including giving the engineer role access to personal
            information. A {ORG_RANK_LABELS.god.toLowerCase()} holds everything
            regardless and needs no role at all.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {overview.orgWideRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No org-wide roles exist. That is not a normal state — the two
              permanent ones are re-ensured on every deploy.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.orgWideRoles.map((r) => (
                <RoleRow
                  key={r.id}
                  role={r}
                  departmentDomains={[]}
                  canManage={canManage}
                  pending={pending}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </ul>
          )}
          {canManage && (
            <div>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setCreatingRole(true)}
              >
                <Plus aria-hidden />
                New role
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Departments
          </CardTitle>
          <CardDescription>
            Nothing hardcodes this list. Create the departments AfrikaBurn
            actually has; each arrives with a permanent lead and member role
            whose rights you can change but which you cannot delete separately.
            Then give each one the parts of the console it answers for.{" "}
            {DEPARTMENT_SCOPE_NOTE}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {canManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => createDepartment({ name: newDepartment }),
                  "Department created, with its lead and member roles.",
                );
              }}
            >
              <Field
                label="New department"
                htmlFor="new-department"
                className="min-w-[16rem] flex-1"
                help="Suppliers, Theme camps, Safety — whatever the org actually runs."
              >
                <Input
                  id="new-department"
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  placeholder="Department name"
                  disabled={pending}
                />
              </Field>
              <Button type="submit" disabled={pending || !newDepartment.trim()}>
                <Plus aria-hidden />
                Add department
              </Button>
            </form>
          )}

          {/* THE GAP, NAMED. Anything no department owns is reachable only by
              an org-wide role — which is the correct fail-closed state and a
              surprise if nobody says it. On a fresh deployment this is every
              domain, and that is exactly when someone needs to be told. */}
          {overview.unownedDomains.length > 0 && departments.length > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
              <Eye
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="text-card-foreground">
                No department owns{" "}
                {listDomainLabels(overview.unownedDomains)}. Only org-wide roles
                reach {overview.unownedDomains.length === 1 ? "it" : "those"} —
                a department-scoped role sees no personal information there and
                deletes nothing there.
              </span>
            </p>
          )}

          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments yet, so every role is org-wide.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {departments.map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.description ?? `Key: ${d.key}`}
                      </p>
                    </div>
                    {canManage && (
                      // Named per department: a page of identical "Delete"
                      // buttons is ambiguous to a screen reader and to anyone
                      // scanning it, and this is not a page to be ambiguous on.
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          aria-label={`Choose what ${d.name} owns`}
                          onClick={() =>
                            setEditingDomains({
                              id: d.id,
                              name: d.name,
                              domains: [...d.domains],
                            })
                          }
                        >
                          What it owns
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          aria-label={`Rename ${d.name}`}
                          onClick={() =>
                            setEditingDepartment({
                              id: d.id,
                              name: d.name,
                              description: d.description,
                            })
                          }
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          aria-label={`Delete ${d.name}`}
                          onClick={() => setConfirmDeleteDepartment(d)}
                        >
                          <Trash2 aria-hidden />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                  {/* WHAT IT OWNS, on the department itself and not buried in
                      a dialog: it is the other half of every scoped role below
                      it, and the empty case is a warning rather than a blank. */}
                  {d.domains.length === 0 ? (
                    <p className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-card-foreground">
                      <TriangleAlert
                        className="mt-px h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      <span>{departmentDomainsNote(d.domains)}</span>
                    </p>
                  ) : (
                    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Owns</span>
                      {d.domains.map((domain) => (
                        <Badge key={domain} variant="secondary">
                          {ORG_DOMAIN_LABELS[domain]}
                        </Badge>
                      ))}
                    </p>
                  )}
                  {d.roles.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      This department has no roles — which should not happen; it
                      is created with two.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {d.roles.map((r) => (
                        <RoleRow
                          key={r.id}
                          role={r}
                          departmentDomains={d.domains}
                          canManage={canManage}
                          pending={pending}
                          onEdit={() => setEditing(r)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (editing || creatingRole) && (
        <RoleEditor
          role={editing}
          departments={departmentOptions}
          pending={pending}
          onCancel={() => {
            setEditing(null);
            setCreatingRole(false);
          }}
          onSave={(draft) => {
            if (editing) {
              run(
                () =>
                  updateOrgRole({
                    roleId: editing.id,
                    name: draft.name,
                    description: draft.description,
                    departmentId: draft.departmentId,
                    color: draft.color,
                    capabilities: draft.capabilities,
                  }),
                "Role saved.",
              );
            } else {
              run(
                () =>
                  createOrgRole({
                    name: draft.name,
                    description: draft.description,
                    departmentId: draft.departmentId,
                    color: draft.color,
                    capabilities: draft.capabilities,
                  }),
                "Role created.",
              );
            }
          }}
          // Deleting a role is a second, deliberate beat with its own count of
          // who loses it — never a button that fires from inside the editor.
          onDelete={
            editing && canDeleteOrgRoleKind(editing.kind)
              ? () => setConfirmDeleteRole(editing)
              : undefined
          }
        />
      )}

      <Dialog
        open={editingDepartment !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditingDepartment(null);
        }}
      >
        <DialogContent className="sm:max-w-[468px]">
          <DialogHeader>
            <DialogTitle>Rename department</DialogTitle>
            <DialogDescription>
              The label changes. Its key, its two permanent roles and everyone
              holding them stay exactly where they are.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor="department-name">
              <Input
                id="department-name"
                value={editingDepartment?.name ?? ""}
                disabled={pending}
                onChange={(e) =>
                  setEditingDepartment((d) =>
                    d ? { ...d, name: e.target.value } : d,
                  )
                }
              />
            </Field>
            <Field
              label="What it answers for"
              htmlFor="department-description"
              help="Optional."
            >
              <Textarea
                id="department-description"
                rows={2}
                value={editingDepartment?.description ?? ""}
                disabled={pending}
                onChange={(e) =>
                  setEditingDepartment((d) =>
                    d ? { ...d, description: e.target.value } : d,
                  )
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setEditingDepartment(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                pending || (editingDepartment?.name.trim().length ?? 0) === 0
              }
              onClick={() =>
                editingDepartment &&
                run(
                  () =>
                    renameDepartment({
                      departmentId: editingDepartment.id,
                      name: editingDepartment.name,
                      description: editingDepartment.description,
                    }),
                  "Department renamed.",
                )
              }
            >
              Save department
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WHAT A DEPARTMENT OWNS. A permissions change in an org-chart costume:
          giving Suppliers the registrations domain hands every Suppliers lead
          every camp member's medical notes, so the dialog names the consequence
          and names who is losing the domain. */}
      <Dialog
        open={editingDomains !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditingDomains(null);
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              What does {editingDomains?.name ?? "this department"} own?
            </DialogTitle>
            <DialogDescription>
              This is what a role scoped to this department reaches. Two rights
              are confined by it — seeing people&rsquo;s details, and permanently
              deleting — so ticking a box here decides whose contact details and
              medical notes this department&rsquo;s leads can read.
            </DialogDescription>
          </DialogHeader>
          {editingDomains && (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Parts of the console</legend>
              {ORG_DOMAINS.map((domain) => {
                const owner = ownerByDomain.get(domain);
                const elsewhere =
                  owner && owner !== editingDomains.name ? owner : null;
                return (
                  <label
                    key={domain}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-sm"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={editingDomains.domains.includes(domain)}
                      disabled={pending}
                      onChange={(e) =>
                        setEditingDomains((d) =>
                          d
                            ? {
                                ...d,
                                domains: e.target.checked
                                  ? [...new Set([...d.domains, domain])]
                                  : d.domains.filter((x) => x !== domain),
                              }
                            : d,
                        )
                      }
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {ORG_DOMAIN_LABELS[domain]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ORG_DOMAIN_DESCRIPTIONS[domain]}
                      </span>
                      {elsewhere && (
                        // The warning treatment used everywhere else on this
                        // screen: a tinted band, not coloured text — the
                        // warning foreground token is meant for use ON that
                        // tint and is unreadable against a card in either
                        // theme.
                        <span className="mt-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-card-foreground">
                          {elsewhere} owns this today — ticking it takes it from
                          them, and their scoped roles stop reaching it.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              <p className="text-xs text-muted-foreground">
                One department owns each of these; nothing is shared. Anything
                left unticked by every department is reachable only by an
                org-wide role.
              </p>
            </fieldset>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setEditingDomains(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                editingDomains &&
                run(
                  () =>
                    setDepartmentDomains({
                      departmentId: editingDomains.id,
                      domains: editingDomains.domains,
                    }),
                  "Saved what this department owns.",
                )
              }
            >
              Save what it owns
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteDepartment !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmDeleteDepartment(null);
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              Delete {confirmDeleteDepartment?.name ?? "this department"}?
            </DialogTitle>
            <DialogDescription>
              A department cannot be deleted on its own — its roles go with it.
            </DialogDescription>
          </DialogHeader>
          {confirmDeleteDepartment && (
            <DepartmentDeletionCost
              department={confirmDeleteDepartment}
              impact={departmentImpact(confirmDeleteDepartment.id)}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDeleteDepartment(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                confirmDeleteDepartment &&
                run(
                  () =>
                    deleteDepartment({
                      departmentId: confirmDeleteDepartment.id,
                    }),
                  "Department deleted, with its roles.",
                )
              }
            >
              Delete department and its roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteRole !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmDeleteRole(null);
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              Delete {confirmDeleteRole?.name ?? "this role"}?
            </DialogTitle>
            <DialogDescription>
              The role is destroyed and everyone holding it loses what it
              granted. Their console access is untouched.
            </DialogDescription>
          </DialogHeader>
          {confirmDeleteRole && (
            <HoldersLosingIt
              impact={roleImpact(confirmDeleteRole.id)}
              nobody="Nobody holds this role, so nobody loses anything."
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDeleteRole(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                confirmDeleteRole &&
                run(
                  () => deleteOrgRole({ roleId: confirmDeleteRole.id }),
                  "Role deleted.",
                )
              }
            >
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Why a permanent role is permanent, in words, WHERE THE DELETE CONTROL ISN'T.
 *
 * The list gets the short form (it repeats on every seeded row) and the editor
 * the full one, in the footer slot the Delete button occupies for a custom role
 * — so the answer is in the place the question is asked, both times.
 */
function permanenceReason(
  role: { departmentName: string | null },
  form: "short" | "full" = "full",
): string {
  if (role.departmentName) {
    return form === "short"
      ? `Permanent — deleting ${role.departmentName} is what removes it.`
      : `Permanent: ${role.departmentName} needs a lead and a member, so this role exists as long as the department does. Deleting the department is what removes it.`;
  }
  return form === "short"
    ? "Permanent — rename it or change what it may do, but it cannot be deleted."
    : "Permanent: it came with the console and is re-ensured on every deploy. Rename it or change what it may do — it cannot be deleted.";
}

function RoleRow({
  role,
  departmentDomains,
  canManage,
  pending,
  onEdit,
}: {
  role: OrgRoleView;
  /** What this role's department owns — the other half of a scoped grant, and
   * what turns "in Suppliers only" into a statement with a referent. */
  departmentDomains: readonly OrgDomain[];
  canManage: boolean;
  pending: boolean;
  onEdit: () => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <RoleSwatch color={role.color} />
          {/* The name is its own element rather than a loose text node: it is
              what every other surface refers to this role by. */}
          <span>{role.name}</span>
          {role.kind === "system" && (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" aria-hidden />
              Permanent
            </Badge>
          )}
          <span className="text-xs font-normal text-muted-foreground">
            {role.holders} {role.holders === 1 ? "person holds it" : "people hold it"}
          </span>
        </span>
        <CapabilitySummary
          grants={grantsForRoles([
            {
              id: role.id,
              departmentId: role.departmentId,
              departmentName: role.departmentName,
              departmentDomains,
              capabilities: role.capabilities,
            },
          ])}
          emptyLabel="Grants nothing at all — holding it changes nothing."
        />
        {role.kind === "system" && (
          <span className="text-xs text-muted-foreground">
            {permanenceReason(role, "short")}
          </span>
        )}
      </span>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Edit rights for ${role.name}`}
          onClick={onEdit}
        >
          Edit rights
        </Button>
      )}
    </li>
  );
}

/** The people a deletion would strip, named — never a silent revocation. */
function HoldersLosingIt({
  impact,
  nobody,
}: {
  impact: DeletionImpact;
  nobody: string;
}) {
  if (impact.people === 0) {
    return <p className="text-sm text-muted-foreground">{nobody}</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-card-foreground">
        <span className="font-medium">
          {impact.people} {impact.people === 1 ? "person" : "people"}
        </span>{" "}
        {impact.people === 1 ? "holds" : "hold"} it, and{" "}
        {impact.people === 1 ? "loses" : "lose"} whatever it granted the moment
        you confirm:
      </p>
      <ul className="flex flex-col gap-0.5 rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[13px]">
        {impact.labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      {impact.leftWithNothing > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-card-foreground">
          {impact.leftWithNothing === 1
            ? "One of them holds no other org role"
            : `${impact.leftWithNothing} of them hold no other org role`}
          , so they will keep console access and find it empty until you give
          them a role.
        </p>
      )}
    </div>
  );
}

/** What deleting a department actually costs: its roles, and its people. */
function DepartmentDeletionCost({
  department,
  impact,
}: {
  department: OrgRolesOverview["departments"][number];
  impact: DeletionImpact;
}) {
  const permanent = department.roles.filter((r) => r.kind === "system");
  const custom = department.roles.filter((r) => r.kind === "custom");
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1.5">
        <p className="text-card-foreground">
          These {department.roles.length}{" "}
          {department.roles.length === 1 ? "role is" : "roles are"} deleted with
          it:
        </p>
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-secondary/40 px-3 py-2">
          {department.roles.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[13px]">
              <RoleSwatch color={r.color} />
              <span>{r.name}</span>
              {r.kind === "system" && (
                <span className="text-xs text-muted-foreground">
                  · permanent, dies with the department
                </span>
              )}
            </li>
          ))}
        </ul>
        {permanent.length > 0 && custom.length > 0 && (
          <p className="text-xs text-muted-foreground">
            That is {permanent.length} permanent and {custom.length} you
            created. Nothing survives the department.
          </p>
        )}
      </div>
      <HoldersLosingIt
        impact={impact}
        nobody="Nobody holds any of them, so nobody loses access today."
      />
      {department.domains.length > 0 && (
        <p className="text-card-foreground">
          {listDomainLabels(department.domains)}{" "}
          {department.domains.length === 1 ? "goes" : "go"} back to being owned
          by nobody, so only org-wide roles will reach{" "}
          {department.domains.length === 1 ? "it" : "them"} until you give{" "}
          {department.domains.length === 1 ? "it" : "them"} to another
          department.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Written to the audit trail with your name on it. There is no undo —
        recreating the department creates new roles, and nobody is re-assigned.
      </p>
    </div>
  );
}

interface RoleDraft {
  name: string;
  description: string | null;
  departmentId: string | null;
  color: RoleColor;
  capabilities: OrgCapability[];
}

function RoleEditor({
  role,
  departments,
  pending,
  onCancel,
  onSave,
  onDelete,
}: {
  role: OrgRoleView | null;
  departments: { id: string; name: string; domains: OrgDomain[] }[];
  pending: boolean;
  onCancel: () => void;
  onSave: (draft: RoleDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<RoleDraft>({
    name: role?.name ?? "",
    description: role?.description ?? null,
    departmentId: role?.departmentId ?? null,
    color: role?.color ?? "neutral",
    capabilities: role?.capabilities ?? [],
  });

  // A department's own lead/member roles stay in their department: a
  // "Suppliers lead" pointed at Safety would be a scoped grant that no longer
  // describes anything. Everything else is free to move.
  const rescopable = role
    ? canRescopeOrgRole({ kind: role.kind, departmentId: role.departmentId })
    : true;
  const chosen = departments.find((d) => d.id === draft.departmentId) ?? null;
  const departmentName = chosen?.name ?? null;
  const departmentDomains = chosen?.domains ?? [];

  // The same resolver the server will run, on the draft in front of them —
  // including what the chosen department owns, so "scoped to Safety" is
  // previewed as the nothing it is when Safety owns nothing.
  const preview = grantsForRoles([
    {
      id: role?.id ?? "draft",
      departmentId: draft.departmentId,
      departmentName,
      departmentDomains,
      capabilities: draft.capabilities,
    },
  ]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            {role?.kind === "system"
              ? "A permanent role. What it may do is entirely yours to change — permanence is about the row existing, never about its rights."
              : "A role you own — rename it, re-right it or delete it whenever."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="role-name">
            <Input
              id="role-name"
              value={draft.name}
              disabled={pending}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>

          <Field
            label="What it is for"
            htmlFor="role-description"
            help="Optional. One line, shown wherever the role is offered."
          >
            <Textarea
              id="role-description"
              rows={2}
              value={draft.description ?? ""}
              disabled={pending}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Field>

          <Field
            label="Department"
            htmlFor="role-department"
            help={
              !rescopable
                ? "This is one of the department's own permanent roles, so it stays there."
                : draft.departmentId === null
                  ? "Org-wide grants its rights everywhere. Scoping it to a department confines the sharp ones — personal information and deletion — to what that department owns."
                  : departmentDomainsNote(departmentDomains)
            }
          >
            <Select
              value={draft.departmentId ?? NO_DEPARTMENT}
              disabled={pending || !rescopable}
              onValueChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  departmentId: value === NO_DEPARTMENT ? null : value,
                }))
              }
            >
              <SelectTrigger id="role-department">
                <SelectValue placeholder="Org-wide" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT}>
                  Org-wide (no department)
                </SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Colour" htmlFor="role-color">
            <div id="role-color" className="flex flex-wrap gap-1.5">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={pending}
                  aria-label={c}
                  aria-pressed={draft.color === c}
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  className="rounded-full p-0.5"
                >
                  <RoleSwatch color={c} selected={draft.color === c} />
                </button>
              ))}
            </div>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              What someone holding it can do
            </legend>
            {GRANTABLE_ORG_CAPABILITIES.map((c) => (
              <label
                key={c}
                className={
                  c === "delete"
                    ? "flex cursor-pointer items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm"
                    : "flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-sm"
                }
              >
                <Checkbox
                  className="mt-0.5"
                  checked={draft.capabilities.includes(c)}
                  disabled={pending}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      capabilities: e.target.checked
                        ? [...new Set([...d.capabilities, c])]
                        : d.capabilities.filter((x) => x !== c),
                    }))
                  }
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{ORG_CAPABILITY_LABELS[c]}</span>
                  <span className="text-xs text-muted-foreground">
                    {ORG_CAPABILITY_DESCRIPTIONS[c]}
                  </span>
                  {/* EVERY capability is department-scoped now, so every one
                      of them says where it lands. Under the old vocabulary only
                      `delete` and personal information were scoped, which is why
                      a department's rights screen could describe powers that
                      were really org-wide — and why every department's delete
                      row talked about suppliers. */}
                  {draft.departmentId !== null && (
                      <span className="text-xs text-muted-foreground">
                        Scoped to {departmentName ?? "this department"}:{" "}
                        {departmentDomains.length === 0
                          ? "which owns no part of the console, so ticking this grants nothing at all."
                          : `${listDomainLabels(departmentDomains)} — and nothing else.`}
                      </span>
                    )}
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Managing accounts, roles and departments is deliberately not on
              this list: it belongs to the{" "}
              {ORG_RANK_LABELS.god.toLowerCase()} and cannot be granted away.
              That is what makes everything above safe to edit.
            </p>
          </fieldset>

          {/* The draft, resolved. Same function the accounts screen renders the
              saved answer with, so what you are told here is what you get. */}
          <div className="rounded-md border border-border bg-secondary/40 p-3">
            <p className="mb-1.5 text-sm font-medium">
              Someone whose only role is this can:
            </p>
            <CapabilitySummary
              grants={preview}
              emptyLabel="Nothing. They would hold this role and the console would still open empty."
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {onDelete ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={onDelete}
              className="mr-auto"
            >
              <Trash2 aria-hidden />
              Delete role
            </Button>
          ) : (
            role?.kind === "system" && (
              <p className="mr-auto flex max-w-[22rem] items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{permanenceReason(role)}</span>
              </p>
            )
          )}
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={pending || draft.name.trim().length === 0}
            onClick={() => onSave(draft)}
          >
            {role ? "Save role" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

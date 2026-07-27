"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, IdCard, UserMinus, UserPlus, Wrench } from "lucide-react";
import {
  ORG_CAPABILITY_LABELS,
  ORG_RANK_DESCRIPTIONS,
  ORG_RANK_LABELS,
  type OrgCapability,
  type OrgDomain,
  type OrgRank,
} from "@quagga/core";
import type { RoleColor } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { Checkbox } from "@quagga/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { RoleSwatch } from "@quagga/ui/components/role-badge";
import { toast } from "@quagga/ui/components/toast";
import { setOrgStaffRole } from "@/lib/actions/accounts";
import { setAccountOrgRoles } from "@/lib/actions/org-roles";
import {
  CapabilitySummary,
  grantsForRoles,
} from "@/components/org-roles/capability-summary";

/** An org role a System manager may assign, as the picker renders it. */
export interface AssignableRole {
  id: string;
  name: string;
  color: RoleColor;
  /** Needed to RESOLVE the draft, not merely to label it — a scoped grant is
   * only a scoped grant if the resolver knows which department it names. */
  departmentId: string | null;
  departmentName: string | null;
  /** …and what that department OWNS, because a scope with nothing behind it is
   * not a smaller grant, it is no grant, and the preview must say which. */
  departmentDomains: OrgDomain[];
  capabilities: OrgCapability[];
}

/**
 * Access controls for one account. Only rendered for the System manager — but
 * rendering is never the boundary: `setOrgStaffRole` re-checks `manage_accounts`
 * (which no role may hold) and `setAccountOrgRoles` re-checks the System manager
 * anchor itself, both refuse god targets, and both audit every change.
 *
 * TWO SEPARATE THINGS, deliberately two separate controls:
 *   · ACCESS — the door. Elevate to org staff / engineer, or remove entirely.
 *   · ROLES  — the rights. Which org roles they hold; `orgCan` resolves the
 *              union. An account with the door and no roles sees an empty
 *              console, which is the correct fail-closed state and is said out
 *              loud in the table rather than left to be discovered.
 *
 * Every state change goes through the Confirm Overlay the canvas draws (frame
 * `uj1wp`, node `UPol9`): icon + what is about to happen + the person it affects
 * + what the grant actually means. This is UX, not security — a mis-click is
 * cheap to make and expensive to undo, so it gets a second beat.
 */
type Intent =
  | { kind: "elevate"; rank: Exclude<OrgRank, "god"> }
  | { kind: "demote" }
  | { kind: "roles" };

export function AccountActions({
  userId,
  personLabel,
  role,
  heldRoleIds,
  assignableRoles,
  isSelf,
}: {
  userId: string;
  /** Who this row is, named in the confirmation copy (frame node `T6n33z`). */
  personLabel: string;
  role: OrgRank | null;
  heldRoleIds: string[];
  assignableRoles: AssignableRole[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>(heldRoleIds);

  if (role === "god") {
    return (
      <span className="text-xs text-muted-foreground">
        System owner — cannot change
      </span>
    );
  }
  if (isSelf) {
    return <span className="text-xs text-muted-foreground">You</span>;
  }

  function run(current: Intent) {
    startTransition(async () => {
      const result =
        current.kind === "roles"
          ? await setAccountOrgRoles({ userId, roleIds: roleDraft })
          : await setOrgStaffRole({
              userId,
              action: current.kind,
              ...(current.kind === "elevate" ? { rank: current.rank } : {}),
            });

      if (result.ok) {
        toast.success(
          current.kind === "roles"
            ? roleDraft.length === 0
              ? "Roles cleared — this account can sign in and do nothing."
              : "Roles saved."
            : current.kind === "elevate"
              ? `Granted ${ORG_RANK_LABELS[current.rank].toLowerCase()} access.`
              : "Removed org access.",
        );
        setIntent(null);
        router.refresh();
      } else {
        toast.error("Could not update access", { description: result.error });
      }
    });
  }

  const Icon =
    intent?.kind === "elevate"
      ? intent.rank === "engineer"
        ? Wrench
        : UserPlus
      : intent?.kind === "roles"
        ? IdCard
        : UserMinus;

  return (
    <>
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        {role === null ? (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => setIntent({ kind: "elevate", rank: "org_staff" })}
            >
              <ArrowUp aria-hidden />
              Give org staff access
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setIntent({ kind: "elevate", rank: "engineer" })}
            >
              <Wrench aria-hidden />
              Give engineer access
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setRoleDraft(heldRoleIds);
                setIntent({ kind: "roles" });
              }}
            >
              <IdCard aria-hidden />
              Roles
            </Button>
            {role === "engineer" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  setIntent({ kind: "elevate", rank: "org_staff" })
                }
              >
                <ArrowUp aria-hidden />
                Switch to org staff
              </Button>
            )}
            {role === "org_staff" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setIntent({ kind: "elevate", rank: "engineer" })}
              >
                <Wrench aria-hidden />
                Switch to engineer
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setIntent({ kind: "demote" })}
            >
              <UserMinus aria-hidden />
              Remove staff access
            </Button>
          </>
        )}
      </span>

      <Dialog
        open={intent !== null}
        // Dismissing (Esc, overlay, close button) only closes — it never acts.
        onOpenChange={(open) => {
          if (!open && !pending) setIntent(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-1 text-left">
                <DialogTitle>
                  {intent?.kind === "elevate"
                    ? `Give ${ORG_RANK_LABELS[intent.rank].toLowerCase()} access?`
                    : intent?.kind === "roles"
                      ? "Which org roles?"
                      : "Remove org staff access?"}
                </DialogTitle>
                <DialogDescription className="font-mono text-[13px]">
                  {personLabel}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {intent?.kind === "roles" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-card-foreground">
                Roles carry the rights. Someone holding several holds everything
                any of them grants. A role scoped to a department grants its
                rights only for that department&rsquo;s things.
              </p>
              <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
                {assignableRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No org roles exist yet. A{" "}
                    {ORG_RANK_LABELS.god.toLowerCase()} creates them under
                    System → Roles.
                  </p>
                ) : (
                  assignableRoles.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-sm"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={roleDraft.includes(r.id)}
                        disabled={pending}
                        onChange={(e) =>
                          setRoleDraft((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, r.id])]
                              : prev.filter((id) => id !== r.id),
                          )
                        }
                      />
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="flex items-center gap-1.5 font-medium">
                          <RoleSwatch color={r.color} />
                          {r.name}
                          {r.departmentName && (
                            <span className="font-normal text-muted-foreground">
                              · {r.departmentName}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.capabilities.length === 0
                            ? "Grants nothing yet."
                            : r.capabilities
                                .map((c) => ORG_CAPABILITY_LABELS[c])
                                .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>

              {/* THE UNION OF THE DRAFT, live. Ticking two roles is not two
                  lists of rights, it is one resolved answer — and the person
                  deciding should read that answer before saving it, not derive
                  it. Same resolver the server refuses with; the action re-checks
                  regardless, so this is honesty rather than authorisation. */}
              <div className="rounded-md border border-border bg-secondary/40 p-3">
                <p className="mb-1.5 text-sm font-medium">
                  With this selection, they will be able to:
                </p>
                <CapabilitySummary
                  grants={grantsForRoles(
                    assignableRoles.filter((r) => roleDraft.includes(r.id)),
                  )}
                  emptyLabel="Nothing. They keep console access and it opens empty."
                />
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-card-foreground">
              {intent?.kind === "elevate"
                ? `${ORG_RANK_DESCRIPTIONS[intent.rank]} This action is logged to the audit trail.`
                : "They lose console access immediately — registrations, suppliers and accounts all close to them, and their org roles are released. This action is logged to the audit trail."}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setIntent(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={intent?.kind === "demote" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => intent && run(intent)}
            >
              {intent?.kind === "elevate"
                ? `Give ${ORG_RANK_LABELS[intent.rank].toLowerCase()} access`
                : intent?.kind === "roles"
                  ? "Save roles"
                  : "Remove staff access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

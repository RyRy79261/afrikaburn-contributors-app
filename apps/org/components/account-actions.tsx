"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Building2, UserMinus, UserPlus, Wrench } from "lucide-react";
import {
  ORG_RANK_DESCRIPTIONS,
  ORG_RANK_LABELS,
  type OrgRank,
} from "@quagga/core";
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
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import { setOrgDepartment, setOrgStaffRole } from "@/lib/actions/accounts";

/**
 * Access controls for one account. Only rendered for the System manager — but
 * rendering is never the boundary: both actions re-check `manage_accounts` on
 * the server, refuse self-changes and god targets, and audit every change.
 *
 * Every state change goes through the Confirm Overlay the canvas draws (frame
 * `CJs0P`, node `mfJhv`): icon + what is about to happen + the person it affects
 * + what the grant actually means (the rank's own description, so the copy can
 * never drift from the matrix). This is UX, not security — a mis-click is cheap
 * to make and expensive to undo, so it gets a second beat.
 */
type Intent =
  | { kind: "elevate"; rank: Exclude<OrgRank, "god"> }
  | { kind: "demote" }
  | { kind: "department" };

export function AccountActions({
  userId,
  personLabel,
  role,
  department,
  isDepartmentLead,
  isSelf,
}: {
  userId: string;
  /** Who this row is, named in the confirmation copy (frame node `xPit0`). */
  personLabel: string;
  role: OrgRank | null;
  department: string | null;
  isDepartmentLead: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [departmentDraft, setDepartmentDraft] = useState(department ?? "");
  const [leadDraft, setLeadDraft] = useState(isDepartmentLead);

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
        current.kind === "department"
          ? await setOrgDepartment({
              userId,
              department: departmentDraft,
              departmentLead: leadDraft,
            })
          : await setOrgStaffRole({
              userId,
              action: current.kind,
              ...(current.kind === "elevate" ? { rank: current.rank } : {}),
            });

      if (result.ok) {
        toast.success(
          current.kind === "department"
            ? "Department saved."
            : current.kind === "elevate"
              ? `Elevated to ${ORG_RANK_LABELS[current.rank].toLowerCase()}.`
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
      : intent?.kind === "department"
        ? Building2
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
              Elevate to org staff
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setIntent({ kind: "elevate", rank: "engineer" })}
            >
              <Wrench aria-hidden />
              Make engineer
            </Button>
          </>
        ) : (
          <>
            {role === "engineer" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  setIntent({ kind: "elevate", rank: "org_staff" })
                }
              >
                <ArrowUp aria-hidden />
                Elevate to org staff
              </Button>
            )}
            {role === "org_staff" && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setIntent({ kind: "elevate", rank: "engineer" })}
              >
                <Wrench aria-hidden />
                Make engineer
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDepartmentDraft(department ?? "");
                setLeadDraft(isDepartmentLead);
                setIntent({ kind: "department" });
              }}
            >
              <Building2 aria-hidden />
              Department
            </Button>
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
        <DialogContent className="sm:max-w-[468px]">
          <DialogHeader>
            <div className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-1 flex-col gap-1 text-left">
                <DialogTitle>
                  {intent?.kind === "elevate"
                    ? `Elevate to ${ORG_RANK_LABELS[intent.rank].toLowerCase()}?`
                    : intent?.kind === "department"
                      ? "Which department?"
                      : "Remove org staff access?"}
                </DialogTitle>
                <DialogDescription className="font-mono text-[13px]">
                  {personLabel}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {intent?.kind === "department" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-card-foreground">
                A label and a lead flag — nothing more. Departments grant no
                extra access today; this records who answers for what, so the
                right person is easy to find.
              </p>
              <Field
                label="Department"
                htmlFor="account-department"
                help="Free text. There is no list of departments to pick from — on purpose."
              >
                <Input
                  id="account-department"
                  value={departmentDraft}
                  onChange={(e) => setDepartmentDraft(e.target.value)}
                  placeholder="Suppliers, Theme camps, Safety…"
                  disabled={pending}
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={leadDraft}
                  onChange={(e) => setLeadDraft(e.target.checked)}
                  disabled={pending}
                />
                They lead this department
              </label>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-card-foreground">
              {intent?.kind === "elevate"
                ? `${ORG_RANK_DESCRIPTIONS[intent.rank]} This action is logged to the audit trail.`
                : "They lose console access immediately — registrations, suppliers and accounts all close to them. This action is logged to the audit trail."}
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
                ? `Elevate to ${ORG_RANK_LABELS[intent.rank].toLowerCase()}`
                : intent?.kind === "department"
                  ? "Save department"
                  : "Remove staff access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

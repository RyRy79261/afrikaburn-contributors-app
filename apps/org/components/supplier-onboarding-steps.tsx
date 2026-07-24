"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, ClipboardCheck, Undo2 } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Badge, type BadgeProps } from "@quagga/ui/components/badge";
import { toast } from "@quagga/ui/components/toast";
import type {
  SupplierOnboardingStepKey,
  SupplierOnboardingStepStatus,
  SupplierOnboardingSteps,
} from "@quagga/types";
import {
  deriveOnboardingProgress,
  isOrgConfirmedStep,
  isOrgReviewedStep,
  type SupplierOnboardingStep,
} from "@quagga/core";
import { setSupplierOnboardingStep } from "@/lib/actions/suppliers";

const STATUS_META: Record<
  SupplierOnboardingStepStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  completed: { label: "Completed", variant: "success" },
  awaiting_confirmation: { label: "Awaiting AfrikaBurn", variant: "warning" },
  pending: { label: "Pending", variant: "outline" },
};

/**
 * Per-step onboarding detail for one supplier × edition, with the org-side
 * actions: confirm/revoke the org-confirmed steps (deposit/briefing/fee) and
 * review-mark the org-reviewed steps (inventory/crew). Steps 1/2 are
 * supplier-driven and shown read-only here. All transitions run @quagga/core's
 * rules server-side with the org actor.
 */
export function SupplierOnboardingStepList({
  supplierId,
  editionId,
  steps,
}: {
  supplierId: string;
  editionId: string;
  steps: SupplierOnboardingSteps;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const progress = deriveOnboardingProgress(steps);

  function move(
    stepKey: SupplierOnboardingStepKey,
    status: SupplierOnboardingStepStatus,
    successMsg: string,
  ) {
    startTransition(async () => {
      const result = await setSupplierOnboardingStep({
        supplierId,
        editionId,
        stepKey,
        status,
      });
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error("Could not update step", { description: result.error });
      }
    });
  }

  return (
    <ol className="flex flex-col gap-2">
      {progress.steps.map(({ step, status }) => (
        <li
          key={step.key}
          className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/20 p-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {step.order}
              </span>
              <span className="text-sm font-medium text-foreground">
                {step.title}
              </span>
              <Badge variant={STATUS_META[status].variant}>
                {STATUS_META[status].label}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {step.description}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StepActions
              step={step}
              status={status}
              pending={pending}
              onMove={move}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepActions({
  step,
  status,
  pending,
  onMove,
}: {
  step: SupplierOnboardingStep;
  status: SupplierOnboardingStepStatus;
  pending: boolean;
  onMove: (
    stepKey: SupplierOnboardingStepKey,
    status: SupplierOnboardingStepStatus,
    successMsg: string,
  ) => void;
}) {
  if (isOrgConfirmedStep(step)) {
    // Deposit / briefing / fee — org confirms outright.
    if (status === "completed") {
      return (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onMove(step.key, "pending", "Confirmation revoked.")}
        >
          <RotateCcw aria-hidden />
          Revoke
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onMove(step.key, "completed", "Confirmed.")}
      >
        <Check aria-hidden />
        Confirm
      </Button>
    );
  }

  if (isOrgReviewedStep(step)) {
    // Inventory / crew — supplier submits, org reviews to complete.
    if (status === "completed") {
      return (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onMove(step.key, "pending", "Step reopened.")}
        >
          <RotateCcw aria-hidden />
          Reopen
        </Button>
      );
    }
    if (status === "awaiting_confirmation") {
      return (
        <>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onMove(step.key, "completed", "Marked reviewed.")}
          >
            <ClipboardCheck aria-hidden />
            Mark reviewed
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onMove(step.key, "pending", "Sent back to supplier.")}
          >
            <Undo2 aria-hidden />
            Send back
          </Button>
        </>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        Awaiting supplier submission
      </span>
    );
  }

  // Self-service (registration form / agreement) — supplier-driven.
  return (
    <span className="text-xs text-muted-foreground">Supplier-completed</span>
  );
}

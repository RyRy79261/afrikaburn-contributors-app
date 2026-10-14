import Link from "next/link";
import {
  CircleCheck,
  Info,
  Lock,
  MessageSquare,
  ReceiptText,
} from "lucide-react";
import { formatRand } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
import type { ClaimView } from "@/lib/camp-money-store";
import {
  CLAIM_STATUS_BADGE,
  claimMetaLine,
  claimStatusLabel,
  moneyDayLabel,
  plural,
  type ClaimFilter,
} from "@/lib/money-view";
import {
  ApproveClaimButton,
  MarkRepaidDialog,
  NewClaimDialog,
  RejectClaimDialog,
  WithdrawClaimButton,
  type ClaimCategory,
  type DecidableClaim,
} from "./claim-forms";
import { Figure, FigureGrid, MoneyFootnote, MoneySection } from "./money-ui";
import { ClaimReceipt } from "./claim-receipt";

// Frame M3 — every claim this edition, for money people only. A claim's own
// author sees it here too, marked "(you)", and cannot decide it: the server
// refuses that whatever this page shows (and a CHECK on the table backs it).

const FILTERS: { key: ClaimFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "repaid", label: "Repaid" },
];

const STATUS_ORDER: Record<ClaimView["status"], number> = {
  submitted: 0,
  approved: 1,
  rejected: 2,
  repaid: 3,
};

export function ClaimsTab({
  slug,
  claims,
  filter,
  categories,
  receiptsEnabled,
}: {
  slug: string;
  claims: ClaimView[];
  filter: ClaimFilter;
  /** Live spending categories (claim form, approve-with-category). */
  categories: ClaimCategory[];
  receiptsEnabled: boolean;
}) {
  const count = (s: ClaimFilter) =>
    s === "all" ? claims.length : claims.filter((c) => c.status === s).length;
  const sum = (s: ClaimFilter) =>
    claims.filter((c) => c.status === s).reduce((n, c) => n + c.amountCents, 0);
  // A queue: what waits for a decision first, then what is still owed, then
  // the settled ones (frame eT62X). Newest first within each status — the
  // loader's order, kept by the stable sort.
  const shown = (
    filter === "all" ? claims : claims.filter((c) => c.status === filter)
  )
    .slice()
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <div className="flex flex-col gap-5">
      <MoneySection
        icon={<ReceiptText />}
        title="Claims"
        description="Members who paid for something for the camp. An approved claim counts as spending in its category; the camp repays it by EFT and a money person marks it repaid."
        action={
          <NewClaimDialog
            slug={slug}
            categories={categories}
            receiptsEnabled={receiptsEnabled}
          />
        }
        testId="money-claims-summary"
      >
        <FigureGrid>
          <Figure
            label="Waiting for a decision"
            value={formatRand(sum("submitted"))}
            sub={plural(count("submitted"), "claim")}
          />
          <Figure
            label="Approved, to repay"
            value={formatRand(sum("approved"))}
            sub={`${plural(count("approved"), "claim")} · counted as spending`}
          />
          <Figure
            label="Repaid"
            value={formatRand(sum("repaid"))}
            sub={`${plural(count("repaid"), "claim")} this edition`}
          />
          <Figure
            label="Rejected"
            value={String(count("rejected"))}
            sub="Not counted in the budget"
          />
        </FigureGrid>
      </MoneySection>

      <nav aria-label="Filter claims" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/camps/${slug}/money?tab=claims${f.key === "all" ? "" : `&status=${f.key}`}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} {count(f.key)}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {claims.length === 0
            ? "No claims yet. When a member claims back money they spent for the camp, it waits here for a decision."
            : "No claims with this status."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((c) => (
            <ClaimCard
              key={c.id}
              slug={slug}
              claim={c}
              categories={categories}
              receiptsEnabled={receiptsEnabled}
            />
          ))}
        </ul>
      )}

      <MoneyFootnote icon={<Lock />}>
        Receipts are private: only the claimant and the camp&apos;s money people
        can open them. Deciding a claim notifies the member, and every decision
        is recorded.
      </MoneyFootnote>
    </div>
  );
}

function ClaimCard({
  slug,
  claim: c,
  categories,
  receiptsEnabled,
}: {
  slug: string;
  claim: ClaimView;
  categories: ClaimCategory[];
  receiptsEnabled: boolean;
}) {
  const decidable: DecidableClaim = {
    id: c.id,
    claimantName: c.claimantName,
    amountCents: c.amountCents,
    categoryId: c.categoryId,
    categoryName: c.categoryName,
    description: c.description,
    decidedAtLabel: c.decidedAt ? moneyDayLabel(c.decidedAt) : null,
  };
  return (
    <li
      className="flex gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-testid="claim-card"
    >
      <ClaimReceipt
        slug={slug}
        id={c.id}
        label={c.receiptLabel}
        canAttach={c.isOwn && c.status === "submitted" && receiptsEnabled}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
            {c.claimantName}
            {c.isOwn && " (you)"}
            <Badge
              variant={CLAIM_STATUS_BADGE[c.status]}
              className="hidden sm:inline-flex"
            >
              {claimStatusLabel(c.status)}
            </Badge>
          </p>
          <p className="hidden shrink-0 font-semibold tabular-nums sm:block">
            {formatRand(c.amountCents)}
          </p>
        </div>
        {/* 360 (frame jgNEH): the amount and status get their own line, so
            a long name can never push the amount out of the card. */}
        <p className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
          <span className="text-lg font-semibold tabular-nums">
            {formatRand(c.amountCents)}
          </span>
          <Badge variant={CLAIM_STATUS_BADGE[c.status]}>
            {claimStatusLabel(c.status)}
          </Badge>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {claimMetaLine(c, "money")}
        </p>
        <p className="mt-1 text-sm">
          {c.description ?? (
            <span className="text-muted-foreground">
              Details deleted with the account.
            </span>
          )}
        </p>

        {c.status === "rejected" && c.decisionNote && (
          <div className="mt-2 flex gap-2 rounded-lg bg-muted/40 p-3 text-xs">
            <MessageSquare
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            <div>
              <p className="font-medium">Decision note</p>
              <p className="text-muted-foreground">{c.decisionNote}</p>
            </div>
          </div>
        )}

        {c.status === "submitted" && c.isOwn && (
          <div className="mt-2 flex gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs">
            <Info
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              aria-hidden
            />
            <p>
              You can&apos;t approve your own claim. Another money person or a
              lead decides it. You can withdraw it while it waits.
            </p>
          </div>
        )}
        {c.status === "approved" && c.isOwn && (
          <p className="mt-2 text-xs text-muted-foreground">
            Another money person or a lead marks your own claim repaid.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start [&_button]:w-full sm:[&_button]:w-auto">
          {c.status === "submitted" && c.mayDecide && (
            <>
              <ApproveClaimButton
                slug={slug}
                claim={decidable}
                categories={categories}
              />
              <RejectClaimDialog slug={slug} claim={decidable} />
            </>
          )}
          {c.status === "submitted" && c.isOwn && (
            <>
              <Button type="button" size="sm" disabled>
                <CircleCheck className="h-4 w-4" aria-hidden />
                Approve
              </Button>
              <WithdrawClaimButton slug={slug} claimId={c.id} />
            </>
          )}
          {c.status === "approved" && c.mayMarkRepaid && (
            <MarkRepaidDialog slug={slug} claim={decidable} />
          )}
        </div>
      </div>
    </li>
  );
}

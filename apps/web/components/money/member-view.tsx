import {
  BarChart3,
  CheckCircle2,
  Info,
  Lock,
  MessageSquare,
  ReceiptText,
  Users,
} from "lucide-react";
import { formatRand } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import type { MemberMoneyView } from "@/lib/camp-money-store";
import {
  CLAIM_STATUS_BADGE,
  DUES_STATUS_BADGE,
  claimMetaLine,
  claimStatusLabel,
  duesStatusLabel,
  moneyDayLabel,
} from "@/lib/money-view";
import { NewClaimDialog, WithdrawClaimButton } from "./claim-forms";
import { ClaimReceipt } from "./claim-receipt";
import { Figure, FigureGrid, MoneyFootnote, MoneySection } from "./money-ui";
import { RefCodeBox } from "./ref-code-box";

// Frame M4 — what EVERY current member sees: the camp's open-books totals,
// and their OWN dues and claims. Nothing else is loaded for this view (the
// store's `loadMemberMoney` reads only the viewer's own rows), so no other
// member's figure can render here.

export function BooksCard({
  view,
  editionName,
}: {
  view: Pick<MemberMoneyView, "totals" | "budgetStatus">;
  editionName: string;
}) {
  const t = view.totals;
  const shortfall = t.surplusCents < 0;
  return (
    <MoneySection
      icon={<BarChart3 />}
      title="The camp's books"
      description={`Totals for ${editionName}, the same for every current member.`}
      testId="money-books"
    >
      <FigureGrid>
        <Figure
          label="Planned spend"
          value={formatRand(t.plannedSpendCents)}
          sub={
            view.budgetStatus === "approved"
              ? "Approved by the leads"
              : "A draft — not approved yet"
          }
        />
        <Figure
          label="Spent so far"
          value={formatRand(t.actualSpendCents)}
          sub={`Plus ${formatRand(t.committedSpendCents)} committed`}
        />
        <Figure
          label="Income received"
          value={formatRand(t.actualIncomeCents)}
          sub="Dues and the camp's other income"
        />
        <Figure
          label="Surplus / shortfall"
          value={formatRand(t.surplusCents)}
          tone={shortfall ? "warning" : "default"}
          sub={`Projected ${shortfall ? "shortfall" : "surplus"}, after a ${t.contingencyPct}% contingency`}
          testId="money-member-surplus"
        />
      </FigureGrid>
    </MoneySection>
  );
}

export function MemberMoney({
  slug,
  editionName,
  view,
}: {
  slug: string;
  editionName: string;
  view: MemberMoneyView;
}) {
  const dues = view.ownDues;
  const f = dues.figures;
  const latest = dues.payments[0];
  const owedSub =
    f.status === "waived"
      ? dues.reason
        ? `Waived: ${dues.reason}`
        : "Waived"
      : f.status === "no_fee"
        ? "The camp hasn't set its fee yet"
        : f.isCampFee
          ? "The camp fee"
          : (dues.reason ?? "Set for you by the camp");

  return (
    <div className="flex flex-col gap-5">
      <BooksCard view={view} editionName={editionName} />

      <MoneySection
        icon={<Users />}
        title="Your dues"
        badge={
          <Badge variant={DUES_STATUS_BADGE[f.status]}>
            {duesStatusLabel(f.status)}
          </Badge>
        }
        description="What you owe the camp this edition, and what it has received from you."
        testId="money-your-dues"
      >
        <div className="flex flex-col gap-4">
          <FigureGrid columns={3}>
            <Figure
              label="Owed"
              value={formatRand(f.owedCents)}
              sub={owedSub}
            />
            <Figure
              label="Received"
              value={formatRand(f.receivedCents)}
              sub={
                latest
                  ? `Recorded ${moneyDayLabel(latest.receivedOn)}`
                  : "Nothing recorded yet"
              }
            />
            <Figure
              label="Outstanding"
              value={formatRand(f.outstandingCents)}
              sub={
                f.outstandingCents > 0
                  ? "Still to pay the camp"
                  : f.overpaidCents > 0
                    ? `Paid up, ${formatRand(f.overpaidCents)} over`
                    : "Nothing outstanding"
              }
              testId="money-own-outstanding"
            />
          </FigureGrid>

          <div className="grid gap-3 md:grid-cols-2">
            {dues.refCode ? (
              <RefCodeBox code={dues.refCode} />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                You don&apos;t have a ref code yet. Ask a lead for one before
                you pay, so the camp can tell the money is yours.
              </div>
            )}
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                How to pay the camp
              </p>
              {view.paymentInstructions ? (
                <p
                  className="mt-1 whitespace-pre-line text-sm"
                  data-testid="money-instructions-text"
                >
                  {view.paymentInstructions}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  The camp hasn&apos;t written its payment details here yet. Ask
                  a lead.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs">
            <Info
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              aria-hidden
            />
            <p>
              Pay from your own bank. When the money arrives in the camp&apos;s
              account, a money person records it here and you get a notice.
              Nothing is paid through this app.
            </p>
          </div>

          {dues.payments.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Received so far
              </p>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {dues.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-success"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {moneyDayLabel(p.receivedOn)} · recorded by{" "}
                      {p.recordedByName}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatRand(p.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </MoneySection>

      <MoneySection
        icon={<ReceiptText />}
        title="Your claims"
        description="Bought something for the camp? Claim it back with the receipt. Approved claims are repaid by EFT from the camp's account."
        action={
          <NewClaimDialog
            slug={slug}
            categories={view.claimCategories}
            receiptsEnabled={view.receiptsEnabled}
          />
        }
        testId="money-your-claims"
      >
        {view.ownClaims.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No claims yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {view.ownClaims.map((c) => (
              <li key={c.id} className="flex gap-3 p-3" data-testid="own-claim">
                <ClaimReceipt
                  slug={slug}
                  id={c.id}
                  label={c.receiptLabel}
                  canAttach={c.status === "submitted" && view.receiptsEnabled}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {c.description ?? "Claim"}
                    </p>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">
                        {formatRand(c.amountCents)}
                      </span>
                      <Badge variant={CLAIM_STATUS_BADGE[c.status]}>
                        {claimStatusLabel(c.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {claimMetaLine(c, "member")}
                  </p>
                  {c.status === "rejected" && c.decisionNote && (
                    <div className="mt-2 flex gap-2 rounded-lg bg-muted/40 p-2 text-xs">
                      <MessageSquare
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      <p className="text-muted-foreground">{c.decisionNote}</p>
                    </div>
                  )}
                  {c.mayWithdraw && (
                    <div className="mt-2">
                      <WithdrawClaimButton slug={slug} claimId={c.id} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </MoneySection>

      <MoneyFootnote icon={<Lock />}>
        Only you and the camp&apos;s money people see your dues, your ref code
        and your claims. Other members see the totals above, never your figures.
      </MoneyFootnote>
    </div>
  );
}

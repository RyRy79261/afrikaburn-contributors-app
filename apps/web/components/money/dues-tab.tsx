import { Landmark, List, Lock, ReceiptText, Users } from "lucide-react";
import { formatRand } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { cn } from "@quagga/ui/lib/utils";
import type { DuesBoard, DuesRowView } from "@/lib/camp-money-store";
import {
  DUES_STATUS_BADGE,
  duesBreakdown,
  duesStatusLabel,
  plural,
} from "@/lib/money-view";
import {
  CampFeeDialog,
  InstructionsDialog,
  PaymentsDialog,
  RecordMoneyDialog,
  SetAmountDialog,
  type DuesMember,
} from "./dues-forms";
import { Figure, FigureGrid, MoneyFootnote, MoneySection } from "./money-ui";

// Frame M2 — dues, for money people only. Every current member, plus former
// members and deleted accounts the books already name, so the books add up.
// Members see only their own dues (the member view), never this list.

function toMember(row: DuesRowView & { userId: string }): DuesMember {
  return {
    userId: row.userId,
    name: row.name,
    refCode: row.refCode,
    owedCents: row.figures.owedCents,
    receivedCents: row.figures.receivedCents,
    outstandingCents: row.figures.outstandingCents,
    isCampFee: row.figures.isCampFee,
    reason: row.reason,
  };
}

/** Rows a money person can act on: a real, non-deleted account. */
function actionable(row: DuesRowView): row is DuesRowView & { userId: string } {
  return row.userId !== null && row.standing !== "deleted";
}

const dash = (cents: number) => (cents === 0 ? "—" : formatRand(cents));

export function DuesTab({
  slug,
  year,
  board,
}: {
  slug: string;
  year: number;
  board: DuesBoard;
}) {
  const { settings, rows, summary } = board;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <MoneySection
          icon={<Users />}
          title="Camp fee"
          description="What each member owes this edition unless you set a different amount for them."
          testId="money-camp-fee"
        >
          <p className="text-2xl font-semibold tabular-nums">
            {formatRand(settings.defaultDuesCents)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              per member
            </span>
          </p>
          <div className="mt-3">
            <CampFeeDialog
              slug={slug}
              campFeeCents={settings.defaultDuesCents}
            />
          </div>
        </MoneySection>
        <MoneySection
          icon={<Landmark />}
          title="How to pay the camp"
          description="Members see this under “Your dues”, with their own ref code. The leads write it."
          testId="money-instructions"
        >
          {settings.paymentInstructions ? (
            <p className="whitespace-pre-line rounded-lg bg-muted/40 p-3 text-sm">
              {settings.paymentInstructions}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              Nothing written yet. Members see their ref code, but not where to
              send money, until you write it.
            </p>
          )}
          <div className="mt-3">
            <InstructionsDialog
              slug={slug}
              instructions={settings.paymentInstructions}
            />
          </div>
        </MoneySection>
      </div>

      <MoneySection
        icon={<ReceiptText />}
        title={`Dues for ${year}`}
        description="Owed is the camp fee or the amount set for a member. Received is money a money person saw arrive in the camp's account."
        testId="money-dues-summary"
      >
        <FigureGrid>
          <Figure
            label="Owed"
            value={formatRand(summary.owedCents)}
            sub={`${plural(summary.memberCount, "member")}${summary.formerCount ? `, ${summary.formerCount} of them former` : ""}`}
          />
          <Figure
            label="Received"
            value={formatRand(summary.receivedCents)}
            sub="Recorded as it arrived"
          />
          <Figure
            label="Outstanding"
            value={formatRand(summary.outstandingCents)}
            sub={
              summary.membersOwing === 0
                ? "Nobody owes the camp"
                : `${plural(summary.membersOwing, "member")} still owe${summary.membersOwing === 1 ? "s" : ""}`
            }
          />
          <Figure
            label="Paid up"
            value={`${summary.byStatus.paid} of ${summary.memberCount}`}
            sub={duesBreakdown(summary.byStatus)}
          />
        </FigureGrid>
      </MoneySection>

      <MoneySection
        icon={<List />}
        title="Members"
        description="Every member this edition, former members included so the books still add up. Only the money people see this list."
        testId="money-dues-members"
      >
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No members yet.
          </p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Member</th>
                    <th className="px-3 py-2 text-right font-medium">Owed</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Received
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outstanding
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, i) => (
                    <tr
                      key={row.userId ?? `deleted-${i}`}
                      data-testid="dues-row"
                    >
                      <td className="px-3 py-2.5 align-top">
                        <MemberCell row={row} />
                      </td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums">
                        {formatRand(row.figures.owedCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums">
                        {dash(row.figures.receivedCents)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right align-top tabular-nums",
                          row.figures.outstandingCents > 0 && "font-semibold",
                        )}
                      >
                        {dash(row.figures.outstandingCents)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <Badge
                          variant={DUES_STATUS_BADGE[row.figures.status]}
                          className="whitespace-nowrap"
                        >
                          {duesStatusLabel(row.figures.status)}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <RowActions
                          slug={slug}
                          row={row}
                          campFeeCents={settings.defaultDuesCents}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-4 py-2.5">
                      All {plural(summary.memberCount, "member")}
                      <p className="text-xs font-normal text-muted-foreground">
                        {summary.currentCount} current
                        {summary.formerCount
                          ? `, ${summary.formerCount} former or deleted`
                          : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatRand(summary.owedCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatRand(summary.receivedCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatRand(summary.outstandingCents)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 360 */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((row, i) => (
                <li
                  key={row.userId ?? `deleted-${i}`}
                  className="rounded-lg border border-border p-3"
                  data-testid="dues-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <MemberCell row={row} />
                    <Badge
                      variant={DUES_STATUS_BADGE[row.figures.status]}
                      className="whitespace-nowrap"
                    >
                      {duesStatusLabel(row.figures.status)}
                    </Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Owed</dt>
                      <dd className="tabular-nums">
                        {formatRand(row.figures.owedCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Received</dt>
                      <dd className="tabular-nums">
                        {dash(row.figures.receivedCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Outstanding</dt>
                      <dd
                        className={cn(
                          "tabular-nums",
                          row.figures.outstandingCents > 0 && "font-semibold",
                        )}
                      >
                        {dash(row.figures.outstandingCents)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2">
                    <RowActions
                      slug={slug}
                      row={row}
                      campFeeCents={settings.defaultDuesCents}
                      stacked
                    />
                  </div>
                </li>
              ))}
              <li className="rounded-lg bg-muted/30 p-3 text-xs">
                <p className="text-sm font-semibold">
                  All {plural(summary.memberCount, "member")}
                </p>
                <p className="mt-0.5 text-muted-foreground tabular-nums">
                  Owed {formatRand(summary.owedCents)} · Received{" "}
                  {formatRand(summary.receivedCents)} · Outstanding{" "}
                  {formatRand(summary.outstandingCents)}
                </p>
              </li>
            </ul>
          </>
        )}
      </MoneySection>

      <MoneyFootnote icon={<Lock />}>
        Members see only their own dues, never anyone else&apos;s. Setting an
        amount or recording money in notifies the member, and every change is
        recorded with who made it.
      </MoneyFootnote>
    </div>
  );
}

function MemberCell({ row }: { row: DuesRowView }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
        {row.name}
        {row.standing === "former" && <Badge variant="outline">Former</Badge>}
      </p>
      {row.refCode && (
        <p className="font-mono text-xs text-muted-foreground">{row.refCode}</p>
      )}
      {row.reason && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.figures.status === "waived"
            ? `Waived: ${row.reason}`
            : row.reason}
        </p>
      )}
    </div>
  );
}

function RowActions({
  slug,
  row,
  campFeeCents,
  stacked = false,
}: {
  slug: string;
  row: DuesRowView;
  campFeeCents: number;
  stacked?: boolean;
}) {
  if (!actionable(row)) {
    return (
      <p className="text-xs text-muted-foreground">
        Amounts kept; the account was deleted.
      </p>
    );
  }
  const member = toMember(row);
  return (
    <div
      className={cn(
        "flex items-center gap-1",
        stacked ? "flex-wrap" : "justify-end whitespace-nowrap",
      )}
    >
      {row.canEdit ? (
        <>
          {row.figures.status !== "waived" && (
            <RecordMoneyDialog slug={slug} member={member} />
          )}
          <SetAmountDialog
            slug={slug}
            member={member}
            campFeeCents={campFeeCents}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          A lead records your own dues.
        </p>
      )}
      {row.figures.receivedCents > 0 && (
        <PaymentsDialog slug={slug} member={member} />
      )}
    </div>
  );
}

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Calculator,
  ClipboardCheck,
  List,
  Paperclip,
  Pencil,
  Plus,
} from "lucide-react";
import {
  BUDGET_STATUS_LABELS,
  describeVariance,
  formatRand,
  type CategoryFigures,
  type MoneyTotals,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
import type { MoneyBooksPage, MoneyEntryView } from "@/lib/camp-money-store";
import { moneyDayLabel, plural, receiptHref } from "@/lib/money-view";
import {
  ApproveBudgetButton,
  DeleteEntryButton,
  EditPlanDialog,
  EntryDialog,
  type PlanCategory,
} from "./budget-forms";
import { Figure, FigureGrid, MoneySection } from "./money-ui";
import { AttachReceiptButton } from "./receipt-input";

// Frame M1 — the budget, for money people only (the page never loads it for
// anyone else). Plan vs actual by category, the totals, and the entries.

const RECENT_ENTRIES = 10;

export interface DuesOutstanding {
  outstandingCents: number;
  membersOwing: number;
}

export function BudgetTab({
  slug,
  year,
  page,
  dues,
  showAllEntries,
}: {
  slug: string;
  year: number;
  page: MoneyBooksPage;
  dues: DuesOutstanding;
  showAllEntries: boolean;
}) {
  const { settings, books, entries } = page;
  const t = books.totals;
  const planCategories: PlanCategory[] = page.categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    plannedCents: c.plannedCents,
    systemKey: c.systemKey,
    archived: c.archived,
  }));
  const editPlan = (
    <EditPlanDialog
      slug={slug}
      contingencyPct={settings.contingencyPct}
      categories={planCategories}
    />
  );
  const contingencyLine = `Planned spend ${formatRand(t.plannedSpendCents)}, with a ${t.contingencyPct}% contingency (${formatRand(t.contingencyCents)}) held back.`;

  return (
    <div className="flex flex-col gap-5">
      <MoneySection
        icon={<ClipboardCheck />}
        title={`Budget for ${year}`}
        badge={
          <Badge
            variant={settings.status === "approved" ? "success" : "outline"}
          >
            {BUDGET_STATUS_LABELS[settings.status]}
          </Badge>
        }
        description={
          settings.status === "approved" ? (
            <>
              Approved by {settings.approvedByName ?? "a money person"} on{" "}
              {moneyDayLabel(settings.approvedAt)}. {contingencyLine} Changes
              since then are recorded with who made them.
            </>
          ) : (
            <>
              Not approved yet. {contingencyLine} Approving records who signed
              it off and when. The plan can still change afterwards, and every
              change is recorded.
            </>
          )
        }
        action={editPlan}
        testId="money-budget-status"
      >
        {settings.status === "draft" && <ApproveBudgetButton slug={slug} />}
      </MoneySection>

      <TotalsCard totals={t} dues={dues} />

      <MoneySection
        icon={<BarChart3 />}
        title="Plan vs actual"
        description="Actual counts paid entries and approved claims; income counts dues received. Variance is planned less actual and committed."
        testId="money-plan-vs-actual"
      >
        <PlanVsActual categories={books.categories} totals={t} />
      </MoneySection>

      <MoneySection
        icon={<List />}
        title={showAllEntries ? "All entries" : "Recent entries"}
        description="Spending and income the money people entered. Dues received and approved claims count from their own tabs, so nothing is entered twice."
        action={
          <EntryDialog
            slug={slug}
            categories={planCategories}
            receiptsEnabled={page.receiptsEnabled}
            trigger={
              <Button type="button" size="sm" className="w-full sm:w-auto">
                <Plus className="h-4 w-4" aria-hidden />
                Add entry
              </Button>
            }
          />
        }
        testId="money-entries"
      >
        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No entries yet. Add what the camp has spent, committed to or taken
            in, with the receipt.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(showAllEntries
                ? entries
                : entries.slice(0, RECENT_ENTRIES)
              ).map((e) => (
                <EntryRow
                  key={e.id}
                  slug={slug}
                  entry={e}
                  categories={planCategories}
                  receiptsEnabled={page.receiptsEnabled}
                />
              ))}
            </ul>
            {!showAllEntries && entries.length > RECENT_ENTRIES && (
              <Link
                href={`/camps/${slug}/money?entries=all`}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                All {entries.length} entries
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </>
        )}
      </MoneySection>
    </div>
  );
}

function TotalsCard({
  totals: t,
  dues,
}: {
  totals: MoneyTotals;
  dues: DuesOutstanding;
}) {
  const shortfall = t.surplusCents < 0;
  return (
    <MoneySection
      icon={<Calculator />}
      title="Totals"
      description="Every current member sees planned spend, spent, income received and the surplus or shortfall. The rest is for the money people."
      testId="money-totals"
    >
      <FigureGrid>
        <Figure
          label="Projected income"
          value={formatRand(t.projectedIncomeCents)}
          sub={`${formatRand(t.actualIncomeCents)} received so far`}
        />
        <Figure
          label="Projected spend"
          value={formatRand(t.projectedSpendCents)}
          sub={`Planned ${formatRand(t.plannedSpendCents)}, raised where actual and committed run over`}
        />
        <Figure
          label="Actual spend"
          value={formatRand(t.actualSpendCents)}
          sub={`Plus ${formatRand(t.committedSpendCents)} committed`}
        />
        <Figure
          label="Cash available"
          value={formatRand(t.cashAvailableCents)}
          sub="Received, less spent and claims repaid"
        />
        <Figure
          label="Surplus / shortfall"
          value={formatRand(t.surplusCents)}
          tone={shortfall ? "warning" : "default"}
          sub={`${shortfall ? "Shortfall" : "Surplus"}, after the ${t.contingencyPct}% contingency`}
          testId="money-surplus"
        />
        <Figure
          label="Cost per camper"
          value={
            t.costPerCamperCents === null
              ? "—"
              : formatRand(t.costPerCamperCents)
          }
          sub={`Projected spend ÷ ${plural(t.currentMemberCount, "current member")}`}
        />
        <Figure
          label="Claims owed"
          value={formatRand(t.claimsOwedCents)}
          sub={`${plural(t.claimsOwedCount, "approved claim")} to repay`}
        />
        {/* Σ per-member outstanding (the Dues tab's figure), not the dues
            category's "to come" — what members owe, not what was planned. */}
        <Figure
          label="Dues outstanding"
          value={formatRand(dues.outstandingCents)}
          sub={
            dues.membersOwing === 0
              ? "Nobody owes the camp"
              : `${plural(dues.membersOwing, "member")} still owe${dues.membersOwing === 1 ? "s" : ""}`
          }
        />
      </FigureGrid>
    </MoneySection>
  );
}

function varianceClass(tone: ReturnType<typeof describeVariance>["tone"]) {
  return cn(
    "tabular-nums",
    tone === "over" && "font-semibold text-warning",
    tone === "above_plan" && "text-success",
    (tone === "left" || tone === "to_come" || tone === "on_plan") &&
      "text-muted-foreground",
  );
}

function Variance({
  row,
}: {
  row: Pick<CategoryFigures, "kind" | "varianceCents">;
}) {
  const v = describeVariance(row.kind, row.varianceCents);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className={varianceClass(v.tone)}>{v.text}</span>
      {v.tone === "over" && <Badge variant="warning">Over</Badge>}
    </span>
  );
}

const dash = (cents: number) => (cents === 0 ? "—" : formatRand(cents));

function PlanVsActual({
  categories,
  totals: t,
}: {
  categories: CategoryFigures[];
  totals: MoneyTotals;
}) {
  const group = (kind: "expense" | "income") => {
    const all = categories.filter((c) => c.kind === kind);
    return {
      shown: all.filter((c) => c.hasActivity),
      quiet: all.filter((c) => !c.hasActivity && !c.archived),
    };
  };
  const spending = group("expense");
  const income = group("income");
  const spendTotal = {
    kind: "expense" as const,
    varianceCents: t.spendVarianceCents,
  };
  const incomeTotal = {
    kind: "income" as const,
    varianceCents: t.incomeVarianceCents,
  };

  const quietLine = (names: string[], kind: "expense" | "income") =>
    names.length > 0 ? (
      <p className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
        {joinNames(names)}: nothing planned or{" "}
        {kind === "expense" ? "spent" : "received"} yet.
      </p>
    ) : null;

  return (
    <>
      {/* Desktop: the table. */}
      <div className="hidden overflow-hidden rounded-lg border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Planned</th>
              <th className="px-4 py-2 text-right font-medium">Actual</th>
              <th className="px-4 py-2 text-right font-medium">Committed</th>
              <th className="px-4 py-2 text-right font-medium">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <GroupHeading label="Spending" />
            {spending.shown.map((c) => (
              <CategoryRow key={c.id ?? "uncategorised"} row={c} />
            ))}
            {spending.quiet.length > 0 && (
              <tr>
                <td colSpan={5}>
                  {quietLine(
                    spending.quiet.map((c) => c.name),
                    "expense",
                  )}
                </td>
              </tr>
            )}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-4 py-2.5">Total spending</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatRand(t.plannedSpendCents)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatRand(t.actualSpendCents)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {dash(t.committedSpendCents)}
              </td>
              <td className="px-4 py-2.5 text-right font-normal">
                <Variance row={spendTotal} />
              </td>
            </tr>
            <GroupHeading label="Income" />
            {income.shown.map((c) => (
              <CategoryRow key={c.id ?? "uncategorised-income"} row={c} />
            ))}
            {income.quiet.length > 0 && (
              <tr>
                <td colSpan={5}>
                  {quietLine(
                    income.quiet.map((c) => c.name),
                    "income",
                  )}
                </td>
              </tr>
            )}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-4 py-2.5">Total income</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatRand(t.plannedIncomeCents)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatRand(t.actualIncomeCents)}
              </td>
              <td className="px-4 py-2.5 text-right">—</td>
              <td className="px-4 py-2.5 text-right font-normal">
                <Variance row={incomeTotal} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 360: one stacked row per category. */}
      <div className="flex flex-col rounded-lg border border-border sm:hidden">
        <MobileHeading label="Spending" />
        {spending.shown.map((c) => (
          <MobileCategory key={c.id ?? "uncategorised"} row={c} />
        ))}
        {quietLine(
          spending.quiet.map((c) => c.name),
          "expense",
        )}
        <MobileTotal
          label="Total spending"
          planned={t.plannedSpendCents}
          actual={t.actualSpendCents}
          committed={t.committedSpendCents}
          variance={spendTotal}
        />
        <MobileHeading label="Income" />
        {income.shown.map((c) => (
          <MobileCategory key={c.id ?? "uncategorised-income"} row={c} />
        ))}
        {quietLine(
          income.quiet.map((c) => c.name),
          "income",
        )}
        <MobileTotal
          label="Total income"
          planned={t.plannedIncomeCents}
          actual={t.actualIncomeCents}
          committed={0}
          variance={incomeTotal}
        />
      </div>
    </>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function GroupHeading({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={5}
        className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </td>
    </tr>
  );
}

function CategoryRow({ row }: { row: CategoryFigures }) {
  return (
    <tr>
      <td className="px-4 py-2.5 font-medium">
        {row.name}
        {row.archived && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (archived)
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {formatRand(row.plannedCents)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {formatRand(row.actualCents)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {dash(row.committedCents)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Variance row={row} />
      </td>
    </tr>
  );
}

function MobileHeading({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
  );
}

function MobileCategory({ row }: { row: CategoryFigures }) {
  return (
    <div className="border-t border-border px-3 py-2.5 first:border-t-0">
      <div className="flex items-start justify-between gap-2 text-sm">
        <span className="font-medium">
          {row.name}
          {row.archived && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              (archived)
            </span>
          )}
        </span>
        <Variance row={row} />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        Planned {formatRand(row.plannedCents)} · Actual{" "}
        {formatRand(row.actualCents)}
        {row.committedCents > 0 &&
          ` · Committed ${formatRand(row.committedCents)}`}
      </p>
    </div>
  );
}

function MobileTotal({
  label,
  planned,
  actual,
  committed,
  variance,
}: {
  label: string;
  planned: number;
  actual: number;
  committed: number;
  variance: Pick<CategoryFigures, "kind" | "varianceCents">;
}) {
  return (
    <div className="border-t border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2 text-sm font-semibold">
        <span>{label}</span>
        <span className="font-normal">
          <Variance row={variance} />
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        Planned {formatRand(planned)} · Actual {formatRand(actual)}
        {committed > 0 && ` · Committed ${formatRand(committed)}`}
      </p>
    </div>
  );
}

function EntryRow({
  slug,
  entry: e,
  categories,
  receiptsEnabled,
}: {
  slug: string;
  entry: MoneyEntryView;
  categories: PlanCategory[];
  receiptsEnabled: boolean;
}) {
  const income = e.kind === "income";
  const pill = income
    ? { label: "Received", variant: "success" as const }
    : e.status === "paid"
      ? { label: "Paid", variant: "secondary" as const }
      : { label: "Committed", variant: "outline" as const };
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
      <span className="hidden w-24 shrink-0 text-xs text-muted-foreground sm:block">
        {moneyDayLabel(e.entryDate)}
      </span>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{e.description}</p>
          <p className="text-xs text-muted-foreground">
            <span className="sm:hidden">{moneyDayLabel(e.entryDate)} · </span>
            {e.categoryName}
            {e.enteredByName && ` · entered by ${e.enteredByName}`}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums sm:hidden",
            income && "text-success",
          )}
        >
          {income ? "+" : ""}
          {formatRand(e.amountCents)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <Badge variant={pill.variant}>{pill.label}</Badge>
        {e.receiptLabel ? (
          <Link
            href={receiptHref("entry", e.id)}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            Receipt
          </Link>
        ) : receiptsEnabled ? (
          <AttachReceiptButton slug={slug} kind="entry" id={e.id} />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            No receipt yet
          </span>
        )}
        <span
          className={cn(
            "ml-auto hidden w-28 text-right text-sm font-semibold tabular-nums sm:inline",
            income && "text-success",
          )}
        >
          {income ? "+" : ""}
          {formatRand(e.amountCents)}
        </span>
        {/* Correct and delete stay together, at the row's end on a phone
            too, instead of wrapping one of them onto a line of its own. */}
        <div className="ml-auto flex items-center sm:ml-0">
          <EntryDialog
            slug={slug}
            categories={categories}
            receiptsEnabled={receiptsEnabled}
            entry={{
              id: e.id,
              categoryId: e.categoryId,
              kind: e.kind,
              amountCents: e.amountCents,
              entryDate: e.entryDate,
              description: e.description,
              status: e.status,
            }}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Correct the entry: ${e.description}`}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
            }
          />
          <DeleteEntryButton
            slug={slug}
            entryId={e.id}
            description={e.description}
            amountCents={e.amountCents}
          />
        </div>
      </div>
    </li>
  );
}

"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

// ResponsiveDataTable — one column declaration, two layouts.
//
// The design system draws every org data list two ways: a real <table> at md+
// and, below md, the SAME rows redrawn as stacked cards (frames NkPRL / y1idvL /
// hSNjO / D6IGel). Four org tables plus the questionnaire results rows each
// hand-rolled the desktop <Table> and got only horizontal scroll on phones — the
// designed mobile card was missing everywhere. This primitive is the single
// place that projection lives: a caller declares its columns ONCE and gets the
// <table> (>= md) and the card list (< md) for free.
//
// Dumb + typed on purpose: no data fetching, no app imports. Cells are render
// functions, so column definitions must live in a client component (this file is
// "use client" for the per-row expansion state) — mirrors suppliers-table.tsx.

/**
 * How a column behaves in the mobile card. Desktop always renders every column
 * in declaration order; the role only steers the card layout.
 * - `title`   — the prominent heading of the card (camp name, email, supplier).
 * - `badge`   — a status/label chip sitting beside the title.
 * - `actions` — the row's action controls, pinned to the card footer.
 * - `default` — a label/value pair, the column header used as the label.
 */
export type ResponsiveColumnRole = "title" | "badge" | "actions" | "default";

export interface ResponsiveColumn<T> {
  /** Stable identity + fallback card label. Must be unique within the set. */
  id: string;
  /** <th> text at md+ and the label of the label/value pair below md. */
  header: React.ReactNode;
  /** Renders the cell for a given row (both layouts). */
  cell: (row: T) => React.ReactNode;
  /** Card behaviour (see ResponsiveColumnRole). Defaults to "default". */
  role?: ResponsiveColumnRole;
  /** Omit this column from the mobile card entirely (still shows at md+). */
  mobileHidden?: boolean;
  /** Render the <th> label as sr-only at md+ (e.g. an actions column). */
  hideHeader?: boolean;
  /** Text alignment for both the <th>/<td> and the card value. */
  align?: "left" | "right" | "center";
  /** Extra class on the md+ <td>. */
  cellClassName?: string;
  /** Extra class on the md+ <th>. */
  headClassName?: string;
}

/**
 * The card projection of a column set: which columns render where in the mobile
 * card. Pure data — no React — so it can be unit-tested directly.
 */
export interface CardProjection<T> {
  /** role === "title" (prominent heading). */
  title: ResponsiveColumn<T>[];
  /** role === "badge" (chips beside the title). */
  badges: ResponsiveColumn<T>[];
  /** role === "actions" (card footer controls). */
  actions: ResponsiveColumn<T>[];
  /** role default/undefined — rendered as header→value pairs. */
  pairs: ResponsiveColumn<T>[];
  /** mobileHidden columns — shown at md+, excluded from the card. */
  hidden: ResponsiveColumn<T>[];
}

/**
 * Partition a column set into its mobile-card slots. `mobileHidden` wins over
 * any role (a hidden column never appears in the card, whatever its role).
 * Declaration order is preserved within every slot.
 */
export function projectColumnsToCard<T>(
  columns: ResponsiveColumn<T>[],
): CardProjection<T> {
  const projection: CardProjection<T> = {
    title: [],
    badges: [],
    actions: [],
    pairs: [],
    hidden: [],
  };

  for (const column of columns) {
    if (column.mobileHidden) {
      projection.hidden.push(column);
      continue;
    }
    switch (column.role) {
      case "title":
        projection.title.push(column);
        break;
      case "badge":
        projection.badges.push(column);
        break;
      case "actions":
        projection.actions.push(column);
        break;
      default:
        projection.pairs.push(column);
        break;
    }
  }

  return projection;
}

const alignText: Record<NonNullable<ResponsiveColumn<unknown>["align"]>, string> =
  {
    left: "text-left",
    right: "text-right",
    center: "text-center",
  };

export interface ResponsiveDataTableProps<T> {
  /** Column set, declared once, drives both layouts. */
  columns: ResponsiveColumn<T>[];
  /** Rows. */
  data: T[];
  /** Stable React key + expansion identity for a row. */
  getRowKey: (row: T) => string;
  /**
   * Optional expandable detail for a row. When provided, a chevron toggle is
   * added (leading column at md+, header-right on mobile) and the returned
   * content renders in a full-width panel beneath the row/card.
   */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Extra class on the md+ <tr> and the mobile card wrapper. */
  rowClassName?: (row: T) => string | undefined;
  /** Shown in place of both layouts when `data` is empty. */
  emptyState?: React.ReactNode;
  /** Accessible <caption> for the md+ table. */
  caption?: React.ReactNode;
  className?: string;
  /**
   * Accessible label for the whole card list region (< md). Defaults to a
   * string derived from `caption` when that is a plain string.
   */
  mobileAriaLabel?: string;
}

export function ResponsiveDataTable<T>({
  columns,
  data,
  getRowKey,
  renderExpanded,
  rowClassName,
  emptyState,
  caption,
  className,
  mobileAriaLabel,
}: ResponsiveDataTableProps<T>) {
  const expandable = Boolean(renderExpanded);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const toggle = React.useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const projection = React.useMemo(
    () => projectColumnsToCard(columns),
    [columns],
  );

  const colSpan = columns.length + (expandable ? 1 : 0);
  const ariaLabel =
    mobileAriaLabel ?? (typeof caption === "string" ? caption : undefined);

  if (data.length === 0 && emptyState !== undefined) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={className}>
      {/* Desktop: real table, md and up. */}
      <div className="hidden md:block">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            <TableRow>
              {expandable ? <TableHead className="w-8" /> : null}
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    column.align ? alignText[column.align] : undefined,
                    column.headClassName,
                  )}
                >
                  {column.hideHeader ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const key = getRowKey(row);
              const isOpen = open.has(key);
              return (
                <React.Fragment key={key}>
                  <TableRow className={rowClassName?.(row)}>
                    {expandable ? (
                      <TableCell className="align-top">
                        <ExpandButton
                          isOpen={isOpen}
                          onToggle={() => toggle(key)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          "align-top",
                          column.align ? alignText[column.align] : undefined,
                          column.cellClassName,
                        )}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {expandable && isOpen ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={colSpan} className="bg-muted/30 p-4">
                        {renderExpanded?.(row)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards, below md. */}
      <ul
        className="flex list-none flex-col gap-3 md:hidden"
        aria-label={ariaLabel}
      >
        {data.map((row) => {
          const key = getRowKey(row);
          const isOpen = open.has(key);
          return (
            <li
              key={key}
              className={cn(
                "rounded-xl border bg-card text-card-foreground shadow-sm",
                rowClassName?.(row),
              )}
            >
              <div className="flex flex-col gap-3 p-4">
                {(projection.title.length > 0 ||
                  projection.badges.length > 0 ||
                  expandable) && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      {projection.title.map((column) => (
                        <div
                          key={column.id}
                          className="text-base font-medium text-foreground"
                        >
                          {column.cell(row)}
                        </div>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {projection.badges.map((column) => (
                        <div key={column.id}>{column.cell(row)}</div>
                      ))}
                      {expandable ? (
                        <ExpandButton
                          isOpen={isOpen}
                          onToggle={() => toggle(key)}
                        />
                      ) : null}
                    </div>
                  </div>
                )}

                {projection.pairs.length > 0 && (
                  <dl className="flex flex-col gap-2">
                    {projection.pairs.map((column) => (
                      <div
                        key={column.id}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {column.header}
                        </dt>
                        <dd
                          className={cn(
                            "min-w-0 text-sm",
                            column.align === "left"
                              ? "text-left"
                              : "text-right",
                          )}
                        >
                          {column.cell(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {projection.actions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {projection.actions.map((column) => (
                      <div key={column.id}>{column.cell(row)}</div>
                    ))}
                  </div>
                )}
              </div>

              {expandable && isOpen ? (
                <div className="border-t border-border bg-muted/30 p-4">
                  {renderExpanded?.(row)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExpandButton({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={isOpen ? "Collapse row" : "Expand row"}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
    >
      {isOpen ? (
        <ChevronDown className="h-4 w-4" aria-hidden />
      ) : (
        <ChevronRight className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

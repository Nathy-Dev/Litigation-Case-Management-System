import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { SortDirection } from '@/types';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Keep it presentational — sorting is handled by the caller. */
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Set when the column can be sorted; the value is passed back to onSort. */
  sortKey?: string;
  /**
   * A CSS length ("11rem", "3rem") applied to the column — not a Tailwind
   * class, since it is set as an inline style. Leave unset for the one column
   * that should absorb the remaining width.
   */
  width?: string;
  /**
   * Drop the column below this breakpoint. Every table here has more columns
   * than a narrow screen can hold, so each one declares the width at which it
   * stops earning its place; the detail page still carries the full record.
   */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: { key: string; dir: SortDirection };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /** Compact density for dense admin tables. */
  dense?: boolean;
  /**
   * `fixed` makes the declared column widths authoritative and hands the
   * remainder to the one column left unsized. Use it where the table has more
   * columns than the viewport can hold, so the wide column yields instead of
   * pushing the rest off the edge. Every cell must be able to truncate.
   */
  layout?: 'auto' | 'fixed';
  caption?: string;
  className?: string;
}

/** The first and last columns line up with the card's own inset. */
const EDGE_INSET = 'first:ps-4 last:pe-4 sm:first:ps-5 sm:last:pe-5';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Written out in full because Tailwind only sees classes that appear literally. */
const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowClick,
  empty,
  dense,
  layout = 'auto',
  caption,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table
        className={cn('w-full min-w-full border-collapse text-sm', layout === 'fixed' && 'table-fixed')}
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50/60">
            {columns.map((column) => {
              const dir = sort && column.sortKey && sort.key === column.sortKey ? sort.dir : null;
              const active = dir !== null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase',
                    EDGE_INSET,
                    ALIGN[column.align ?? 'left'],
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.sortKey && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.sortKey!)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded transition-colors hover:text-ink-800',
                        active && 'text-brand-700',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      {active ? (
                        dir === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 sm:px-5">
                {empty ?? <p className="text-center text-sm text-ink-500">No records found.</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-ink-100 last:border-0',
                  onRowClick && 'cursor-pointer transition-colors hover:bg-brand-50/50',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 align-middle text-ink-700',
                      EDGE_INSET,
                      dense ? 'py-2' : 'py-3',
                      ALIGN[column.align ?? 'left'],
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                      // A column's class covers the header *and* its cells, so
                      // things like `whitespace-nowrap` only need saying once.
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Stops a row-level click when interacting with controls inside a cell. */
export function CellActions({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
      role="presentation"
    >
      {children}
    </div>
  );
}

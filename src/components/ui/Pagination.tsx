import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, clamp } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Button } from './Button';
import { Select } from './Input';

interface PaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Noun for the "N matters" summary. */
  label?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label = 'records',
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-ink-500">
        Showing <span className="tnum font-medium text-ink-700">{formatNumber(from)}</span>–
        <span className="tnum font-medium text-ink-700">{formatNumber(to)}</span> of{' '}
        <span className="tnum font-medium text-ink-700">{formatNumber(total)}</span> {label}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-[13px] text-ink-500">
            Rows
            <Select
              sizing="sm"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="w-18"
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            icon={<ChevronLeft className="size-4" aria-hidden />}
          />
          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} className="px-1 text-ink-400">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPageChange(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  'tnum size-8 rounded-md text-[13px] font-medium transition-colors',
                  entry === page
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                )}
              >
                {entry}
              </button>
            ),
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            icon={<ChevronRight className="size-4" aria-hidden />}
          />
        </div>
      </div>
    </div>
  );
}

/** Windowed page list: 1 … 4 5 6 … 20 */
function pageNumbers(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const middle = clamp(page, 3, pageCount - 2);
  const pages = new Set([1, middle - 1, middle, middle + 1, pageCount]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);

  const result: Array<number | null> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1]! > 1) result.push(null);
    result.push(value);
  });
  return result;
}

/** Table footer that pairs the pagination with optional bulk actions. */
export function TableFooter({ children }: { children: ReactNode }) {
  return <div className="border-t border-ink-200/70 px-4 py-3 sm:px-5">{children}</div>;
}

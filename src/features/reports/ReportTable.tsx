import { useState } from 'react';
import { TableProperties } from 'lucide-react';
import type { ReportColumn } from '@/types';
import type { ReportRow } from '@/lib/selectors/reports';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

const PAGE_SIZE = 25;

/**
 * Renders any report result. Because every report returns the same
 * `{columns, rows}` shape, one table serves all six and the ad-hoc builder.
 */
export function ReportTable({
  columns,
  rows,
  footer,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  footer?: string;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<TableProperties className="size-6" aria-hidden />}
          title="No rows to report"
          description="Nothing in the register matches this report on the current filters."
        />
      </Card>
    );
  }

  const visible = rows.slice(0, shown);

  return (
    <Card flush>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-500 uppercase whitespace-nowrap',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={index}
                className={cn(
                  'border-b border-ink-100 last:border-b-0',
                  index % 2 === 1 && 'bg-ink-50/40',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2 text-ink-800',
                      column.align === 'right' ? 'tnum text-right' : 'text-left',
                    )}
                  >
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-3 py-2">
        <p className="text-[12px] text-ink-500">
          Showing <span className="font-semibold text-ink-700">{visible.length}</span> of{' '}
          {rows.length} rows{footer ? ` · ${footer}` : ''}
        </p>
        {shown < rows.length && (
          <Button size="sm" onClick={() => setShown((value) => value + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, rows.length - shown)} more
          </Button>
        )}
      </div>
    </Card>
  );
}
